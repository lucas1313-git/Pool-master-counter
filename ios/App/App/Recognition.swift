import UIKit
import AVFoundation
import Capacitor

// The iPad's own player recognition - step 1, the skeleton: a native
// Recognition screen that runs a camera (a USB camera such as a Logitech
// Brio first - iPadOS 17 and later expose them to apps) and talks to the
// scoreboard on a computer as the "camera", through the camera contract
// (docs/camera-protocol.md on main): it says hello, keeps its three status
// lights up to date, sends a heartbeat, receives the players, answers the
// scoreboard's camera list. Finding, following and recognizing players
// (Apple Vision, face recognition on the Neural Engine) come in the next
// steps; only processed information ever leaves this screen.
//
// Opened from the scoreboard's camera setup ("iPad recognition (USB
// camera)", shown only in this app) through RecognitionPlugin, or - for
// tests - at launch with -PMCRecognitionAutoOpen YES
// -PMCRecognitionServer ws://<computer>:4173.

// MARK: - Plugin (JS: Capacitor.Plugins.Recognition)

@objc(RecognitionPlugin)
public class RecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RecognitionPlugin"
    public let jsName = "Recognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        guard RecognitionSettings.autoOpen else { return }
        // (tests: open once the scoreboard page is on screen)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if let host = self?.bridge?.viewController { RecognitionViewController.present(from: host) }
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let host = self?.bridge?.viewController else {
                call.reject("No screen to open the Recognition screen from")
                return
            }
            RecognitionViewController.present(from: host)
            call.resolve()
        }
    }

    @objc func info(_ call: CAPPluginCall) {
        call.resolve(["externalCameras": CameraSource.supportsExternalCameras, "protocol": RelayClient.protocolVersion])
    }
}

// MARK: - Saved choices

enum RecognitionSettings {
    private static let serverKey = "PMCRecognitionServer"
    private static let cameraKey = "PMCRecognitionCamera"
    // (a launch argument -PMCRecognitionServer wins: UserDefaults' argument domain)
    static var serverAddress: String {
        get { UserDefaults.standard.string(forKey: serverKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: serverKey) }
    }
    static var cameraID: String? {
        get { UserDefaults.standard.string(forKey: cameraKey) }
        set { UserDefaults.standard.set(newValue, forKey: cameraKey) }
    }
    static var autoOpen: Bool { UserDefaults.standard.bool(forKey: "PMCRecognitionAutoOpen") }
}

// MARK: - Camera

final class CameraSource: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    static var supportsExternalCameras: Bool {
        if #available(iOS 17.0, *) { return true }
        return false
    }

    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "pmc.recognition.camera")
    private let frameQueue = DispatchQueue(label: "pmc.recognition.frames")
    private let output = AVCaptureVideoDataOutput()
    private(set) var current: AVCaptureDevice?
    /// "starting" | "active" | "stopped" | "error" - the contract's camera light
    var onStatus: ((String) -> Void)?
    /// every frame, on a background queue (the recognition steps hook in here)
    var onFrame: ((CMSampleBuffer) -> Void)?
    private let frameLock = NSLock()
    private var frameCount = 0
    var framesSeen: Int { frameLock.lock(); defer { frameLock.unlock() }; return frameCount }

    /// USB cameras first, then the back cameras, then the front one.
    static func availableCameras() -> [AVCaptureDevice] {
        var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .builtInUltraWideCamera]
        if #available(iOS 17.0, *) { types.insert(.external, at: 0) }
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
        return devices.sorted { rank($0) < rank($1) }
    }
    static func isExternal(_ device: AVCaptureDevice) -> Bool {
        if #available(iOS 17.0, *) { return device.deviceType == .external }
        return false
    }
    private static func rank(_ device: AVCaptureDevice) -> Int {
        if isExternal(device) { return 0 }
        return device.position == .back ? 1 : 2
    }

    func start(_ device: AVCaptureDevice) {
        onStatus?("starting")
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.session.beginConfiguration()
            self.session.inputs.forEach { self.session.removeInput($0) }
            var ok = false
            if let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input) {
                self.session.addInput(input)
                if self.session.outputs.isEmpty {
                    self.output.alwaysDiscardsLateVideoFrames = true
                    self.output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                    self.output.setSampleBufferDelegate(self, queue: self.frameQueue)
                    if self.session.canAddOutput(self.output) { self.session.addOutput(self.output) }
                }
                // 1080p for now: enough for the next steps' body points; faces
                // will want the camera's 4K, chosen there
                self.session.sessionPreset = self.session.canSetSessionPreset(.hd1920x1080) ? .hd1920x1080 : .high
                ok = true
            }
            self.session.commitConfiguration()
            if ok {
                self.current = device
                if !self.session.isRunning { self.session.startRunning() }
            }
            let running = ok && self.session.isRunning
            DispatchQueue.main.async { self.onStatus?(running ? "active" : "error") }
        }
    }

    func stop() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            if self.session.isRunning { self.session.stopRunning() }
            DispatchQueue.main.async { self.onStatus?("stopped") }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        frameLock.lock(); frameCount += 1; frameLock.unlock()
        onFrame?(sampleBuffer)
    }
}

// MARK: - The camera contract over WebSocket (docs/camera-protocol.md)

final class RelayClient: NSObject, URLSessionWebSocketDelegate {
    static let protocolVersion = 1

    /// "connecting" | "connected" | "disconnected" - the contract's link light
    var onStatus: ((String) -> Void)?
    var onConnected: (() -> Void)?
    var onMessage: (([String: Any]) -> Void)?
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private(set) var url: URL?
    private var wanted = false
    private var reconnectWork: DispatchWorkItem?

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue.main)
    }

    /// "10.0.0.52", "10.0.0.52:4173", "http(s)://...", "ws(s)://..." -> ws(s)://host:port/ws-camera
    static func url(from address: String) -> URL? {
        var a = address.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return nil }
        if a.hasPrefix("http://") { a = "ws://" + a.dropFirst(7) }
        else if a.hasPrefix("https://") { a = "wss://" + a.dropFirst(8) }
        else if !a.contains("://") { a = "ws://" + a }
        guard var parts = URLComponents(string: a), parts.host != nil, parts.scheme == "ws" || parts.scheme == "wss" else { return nil }
        if parts.port == nil { parts.port = parts.scheme == "wss" ? 4174 : 4173 }
        if parts.path.isEmpty || parts.path == "/" || parts.path == "/camera.html" { parts.path = "/ws-camera" }
        return parts.url
    }

    func connect(to address: String) -> Bool {
        guard let u = Self.url(from: address) else { return false }
        url = u
        wanted = true
        open()
        return true
    }

    func disconnect() {
        wanted = false
        reconnectWork?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        onStatus?("disconnected")
    }

    var isConnected: Bool { task != nil && connectedTask === task }
    private var connectedTask: URLSessionWebSocketTask?

    private func open() {
        guard let url = url else { return }
        task?.cancel(with: .goingAway, reason: nil)
        onStatus?("connecting")
        let t = session.webSocketTask(with: url)
        task = t
        t.resume()
        receive(on: t)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        connectedTask = webSocketTask
        // (protocol/app: version 2's proposed hello - the server ignores what it doesn't know)
        send(["type": "hello", "role": "camera", "protocol": Self.protocolVersion, "app": "PMC iPad Recognition"])
        onStatus?("connected")
        onConnected?()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        closed(webSocketTask)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let ws = task as? URLSessionWebSocketTask { closed(ws) }
    }

    // The desktop app's https port has a certificate of its own - accepted,
    // but only for an address on the local network.
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust, Self.isLocal(challenge.protectionSpace.host) {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        completionHandler(.performDefaultHandling, nil)
    }

    static func isLocal(_ host: String) -> Bool {
        if host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("127.") || host.hasPrefix("10.") || host.hasPrefix("192.168.") { return true }
        let p = host.split(separator: ".")
        if p.count == 4, p[0] == "172", let n = Int(p[1]) { return (16...31).contains(n) }
        return false
    }

    private func closed(_ t: URLSessionWebSocketTask) {
        guard t === task else { return }
        task = nil
        connectedTask = nil
        onStatus?("disconnected")
        guard wanted else { return }
        reconnectWork?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self = self, self.wanted, self.task == nil else { return }
            self.open()
        }
        reconnectWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: w)
    }

    private func receive(on t: URLSessionWebSocketTask) {
        t.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self = self, t === self.task else { return }
                switch result {
                case .success(let message):
                    var data: Data?
                    switch message {
                    case .string(let s): data = s.data(using: .utf8)
                    case .data(let d): data = d
                    @unknown default: data = nil
                    }
                    if let d = data, let obj = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                        self.onMessage?(obj)
                    }
                    self.receive(on: t)
                case .failure:
                    self.closed(t)
                }
            }
        }
    }

    func send(_ msg: [String: Any]) {
        guard let t = task, let data = try? JSONSerialization.data(withJSONObject: msg), let s = String(data: data, encoding: .utf8) else { return }
        t.send(.string(s)) { _ in }
    }
}

// MARK: - The Recognition screen

final class RecognitionViewController: UIViewController, UITextFieldDelegate {
    static func present(from host: UIViewController) {
        if host.presentedViewController is RecognitionViewController { return }
        let vc = RecognitionViewController()
        vc.modalPresentationStyle = .fullScreen
        host.present(vc, animated: true)
    }

    private let camera = CameraSource()
    private let relay = RelayClient()
    private var heartbeat: Timer?

    // the contract's three lights
    private var linkStatus = "disconnected" { didSet { statusChanged() } }
    private var modelsStatus = "ready" { didSet { statusChanged() } }
    private var cameraStatus = "stopped" { didSet { statusChanged() } }

    // the players, as the scoreboard last sent them
    private var rosterNames: [String] = []
    private var playingNames: [String] = []

    // UI
    private let previewView = PreviewView()
    private let panel = UIStackView()
    private let content = UIStackView()
    private let cameraButton = UIButton(type: .system)
    private let addressField = UITextField()
    private let connectButton = UIButton(type: .system)
    private let linkRow = StatusRow(title: "Scoreboard")
    private let modelsRow = StatusRow(title: "Recognition")
    private let cameraRow = StatusRow(title: "Camera")
    private let playersLabel = UILabel()
    private let logView = UITextView()
    private let framesLabel = UILabel()
    private var panelWidth: NSLayoutConstraint!
    private var portraitPreviewHeight: NSLayoutConstraint!
    private var lastSentStatus: [String: String]?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.09, green: 0.04, blue: 0.04, alpha: 1)
        buildUI()

        camera.onStatus = { [weak self] status in
            self?.cameraStatus = status
            self?.log("Camera: " + status + (self?.camera.current.map { " (" + $0.localizedName + ")" } ?? ""))
        }
        relay.onStatus = { [weak self] status in
            if status != "connected" { self?.lastSentStatus = nil }
            self?.linkStatus = status
        }
        relay.onConnected = { [weak self] in self?.didConnect() }
        relay.onMessage = { [weak self] msg in self?.handle(msg) }

        NotificationCenter.default.addObserver(self, selector: #selector(camerasChanged), name: .AVCaptureDeviceWasConnected, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(camerasChanged), name: .AVCaptureDeviceWasDisconnected, object: nil)

        addressField.text = RecognitionSettings.serverAddress
        startCameraWhenAllowed()
        if !RecognitionSettings.serverAddress.isEmpty { connect() }
        log("Recognition screen opened - step 1: camera and scoreboard link; recognizing players comes next.")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        UIApplication.shared.isIdleTimerDisabled = true
        heartbeat?.invalidate()
        // the contract: player-states at least every 3 s (the scoreboard greys
        // every icon after 10 s of silence) - none known yet in step 1
        heartbeat = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.beat() }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        UIApplication.shared.isIdleTimerDisabled = false
        heartbeat?.invalidate()
        heartbeat = nil
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        // side by side in landscape, picture (16:9) above the panel in portrait
        let landscape = view.bounds.width >= view.bounds.height
        content.axis = landscape ? .horizontal : .vertical
        panelWidth.isActive = landscape
        portraitPreviewHeight.isActive = !landscape
    }

    // MARK: UI

    private func buildUI() {
        let title = UILabel()
        title.text = "🎯 Recognition"
        title.font = .systemFont(ofSize: 26, weight: .heavy)
        title.textColor = UIColor(red: 0.91, green: 0.73, blue: 0.14, alpha: 1)
        let close = UIButton(type: .system)
        close.setTitle("Close", for: .normal)
        close.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        close.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        close.accessibilityIdentifier = "recognition-close"
        let top = UIStackView(arrangedSubviews: [title, UIView(), close])
        top.axis = .horizontal

        cameraButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        cameraButton.contentHorizontalAlignment = .leading
        cameraButton.showsMenuAsPrimaryAction = true
        cameraButton.accessibilityIdentifier = "recognition-camera"
        refreshCameraMenu()

        addressField.placeholder = "Computer address, e.g. 10.0.0.52"
        addressField.borderStyle = .roundedRect
        addressField.autocapitalizationType = .none
        addressField.autocorrectionType = .no
        addressField.keyboardType = .URL
        addressField.returnKeyType = .go
        addressField.delegate = self
        addressField.accessibilityIdentifier = "recognition-address"
        connectButton.setTitle("Connect", for: .normal)
        connectButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .bold)
        connectButton.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)
        let addressRow = UIStackView(arrangedSubviews: [addressField, connectButton])
        addressRow.spacing = 8

        playersLabel.numberOfLines = 0
        playersLabel.textColor = .white
        playersLabel.font = .systemFont(ofSize: 17)
        playersLabel.text = "No players yet - they come from the scoreboard."

        framesLabel.textColor = UIColor(white: 0.7, alpha: 1)
        framesLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)

        logView.isEditable = false
        logView.backgroundColor = UIColor(white: 0, alpha: 0.35)
        logView.textColor = UIColor(white: 0.85, alpha: 1)
        logView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        logView.layer.cornerRadius = 8
        logView.heightAnchor.constraint(greaterThanOrEqualToConstant: 140).isActive = true

        panel.axis = .vertical
        panel.spacing = 10
        [heading("Camera"), cameraButton, heading("Scoreboard on your computer"), addressRow,
         heading("Status"), linkRow, modelsRow, cameraRow, framesLabel,
         heading("Players"), playersLabel, heading("Activity"), logView].forEach { panel.addArrangedSubview($0) }

        previewView.backgroundColor = .black
        previewView.layer.cornerRadius = 12
        previewView.clipsToBounds = true
        previewView.previewLayer.session = camera.session
        previewView.previewLayer.videoGravity = .resizeAspect

        content.spacing = 16
        content.alignment = .fill
        content.distribution = .fill
        content.addArrangedSubview(previewView)
        content.addArrangedSubview(panel)
        panel.setContentHuggingPriority(.required, for: .horizontal)
        panelWidth = panel.widthAnchor.constraint(equalToConstant: 380)
        panelWidth.priority = .defaultHigh
        portraitPreviewHeight = previewView.heightAnchor.constraint(equalTo: previewView.widthAnchor, multiplier: 9.0 / 16.0)

        let page = UIStackView(arrangedSubviews: [top, content])
        page.axis = .vertical
        page.spacing = 12
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(page)
        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            page.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 16),
            page.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -16),
            page.topAnchor.constraint(equalTo: g.topAnchor, constant: 12),
            page.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12)
        ])
        statusChanged()
    }

    private func heading(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text.uppercased()
        l.font = .systemFont(ofSize: 12, weight: .bold)
        l.textColor = UIColor(white: 0.65, alpha: 1)
        return l
    }

    private func refreshCameraMenu() {
        let cameras = CameraSource.availableCameras()
        let current = camera.current?.uniqueID
        let actions = cameras.map { device -> UIAction in
            let name = (CameraSource.isExternal(device) ? "🔌 " : "📷 ") + device.localizedName
            return UIAction(title: name, state: device.uniqueID == current ? .on : .off) { [weak self] _ in self?.choose(device) }
        }
        cameraButton.menu = UIMenu(title: cameras.isEmpty ? "No camera found" : "Cameras", children: actions)
        let shown = camera.current.map { (CameraSource.isExternal($0) ? "🔌 " : "📷 ") + $0.localizedName } ?? (cameras.isEmpty ? "No camera found - plug in the USB camera" : "Choose a camera")
        cameraButton.setTitle(shown + "  ▾", for: .normal)
    }

    // MARK: Camera

    private func startCameraWhenAllowed() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startPreferredCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async { [weak self] in
                    if granted { self?.startPreferredCamera() } else { self?.cameraDenied() }
                }
            }
        default:
            cameraDenied()
        }
    }

    private func cameraDenied() {
        cameraStatus = "error"
        log("Camera access is off for this app - turn it on in Settings > Pool Master Counter > Camera.")
    }

    /// The saved camera if it's there, else a USB camera, else the back camera.
    private func startPreferredCamera() {
        let cameras = CameraSource.availableCameras()
        let saved = RecognitionSettings.cameraID.flatMap { id in cameras.first { $0.uniqueID == id } }
        guard let device = saved ?? cameras.first else {
            cameraStatus = "stopped"
            log("No camera found" + (CameraSource.supportsExternalCameras ? " - plug in the USB camera." : "."))
            refreshCameraMenu()
            return
        }
        choose(device, save: false)
    }

    private func choose(_ device: AVCaptureDevice, save: Bool = true) {
        if save { RecognitionSettings.cameraID = device.uniqueID }
        camera.start(device)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in
            self?.refreshCameraMenu()
            self?.sendCameraList()
        }
    }

    @objc private func camerasChanged(_ note: Notification) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let device = note.object as? AVCaptureDevice
            if note.name == .AVCaptureDeviceWasDisconnected, let d = device, d.uniqueID == self.camera.current?.uniqueID {
                self.log("The camera was unplugged.")
                self.camera.stop()
            } else if note.name == .AVCaptureDeviceWasConnected, let d = device, CameraSource.isExternal(d) {
                self.log("USB camera plugged in: " + d.localizedName)
                if self.cameraStatus != "active" || !(self.camera.current.map(CameraSource.isExternal) ?? false) { self.choose(d) }
            }
            self.refreshCameraMenu()
            self.sendCameraList()
        }
    }

    // MARK: Scoreboard link

    @objc private func connectTapped() { connect() }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        connect()
        return true
    }

    private func connect() {
        let address = (addressField.text ?? "").trimmingCharacters(in: .whitespaces)
        addressField.resignFirstResponder()
        guard relay.connect(to: address) else {
            log("That doesn't look like an address - try the computer's, e.g. 10.0.0.52")
            return
        }
        RecognitionSettings.serverAddress = address
        log("Connecting to " + (relay.url?.absoluteString ?? address) + "...")
    }

    private func didConnect() {
        log("Connected to the scoreboard.")
        sendStatus()
        relay.send(["type": "roster-request"])
        sendCameraList()
        beat()
    }

    private func statusChanged() {
        linkRow.set(linkStatus, color: linkStatus == "connected" ? .green : linkStatus == "connecting" ? .orange : .red)
        modelsRow.set(modelsStatus == "ready" ? "ready (players come in step 2)" : modelsStatus, color: modelsStatus == "ready" ? .green : .orange)
        cameraRow.set(cameraStatus, color: cameraStatus == "active" ? .green : cameraStatus == "starting" ? .orange : .red)
        sendStatus()
    }

    private func sendStatus() {
        let status = ["link": linkStatus, "models": modelsStatus, "camera": cameraStatus]
        guard relay.isConnected, status != lastSentStatus else { return }
        lastSentStatus = status
        relay.send(["type": "camera-status", "status": status])
    }

    private func beat() {
        framesLabel.text = "Frames from the camera: \(camera.framesSeen)"
        guard relay.isConnected else { return }
        relay.send(["type": "player-states", "states": [String: String]()])
    }

    private func sendCameraList() {
        guard relay.isConnected else { return }
        let devices = CameraSource.availableCameras().map { ["deviceId": $0.uniqueID, "label": $0.localizedName] }
        relay.send(["type": "remote-camera-list", "devices": devices, "currentDeviceId": camera.current?.uniqueID ?? NSNull()])
    }

    private func handle(_ msg: [String: Any]) {
        let type = msg["type"] as? String ?? ""
        switch type {
        case "roster":
            rosterNames = msg["names"] as? [String] ?? []
            playingNames = msg["playing"] as? [String] ?? rosterNames
            showPlayers()
            log("Players: \(rosterNames.count), playing: \(playingNames.count)")
        case "turn_confirmed":
            log("Scored for " + (msg["player_name"] as? String ?? "?"))
        case "enroll-press":
            // samples are learned from step 3 (faces); until then the
            // scoreboard says "The camera isn't running"
            let name = msg["player_name"] as? String ?? ""
            let kind = (msg["kind"] as? String) == "shooting" ? "shooting" : "identify"
            log("Number pad: " + name + " " + (kind == "shooting" ? "shooting" : "seen") + " (samples come in step 3)")
            relay.send(["type": "enroll-result", "ok": false, "reason": "not-running", "player_name": name, "kind": kind])
        case "enroll-undo":
            log("Number pad: take back the last sample (none yet)")
            relay.send(["type": "enroll-result", "ok": false, "reason": "nothing-to-undo"])
        case "remote-camera-list-request":
            sendCameraList()
        case "remote-camera-select":
            if let id = msg["deviceId"] as? String, let d = CameraSource.availableCameras().first(where: { $0.uniqueID == id }) {
                log("The scoreboard chose " + d.localizedName)
                choose(d)
            }
        case "camera-settings-request":
            // (the scoreboard asks this whenever it connects - a scoreboard
            // opened after this screen gets the lights and cameras too)
            relay.send(["type": "camera-settings-state", "settings": [String: Any]()])
            lastSentStatus = nil
            sendStatus()
            sendCameraList()
        case "ball_feedback":
            log("Ball correction: " + (msg["kind"] as? String ?? "?"))
        default:
            break
        }
    }

    private func showPlayers() {
        if rosterNames.isEmpty {
            playersLabel.text = "No players yet - add them on the scoreboard."
            return
        }
        let playing = Set(playingNames.map { $0.lowercased() })
        playersLabel.text = rosterNames.map { playing.contains($0.lowercased()) ? "● " + $0 : "○ " + $0 + " (standby)" }.joined(separator: "\n")
    }

    private func log(_ text: String) {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        let line = f.string(from: Date()) + "  " + text
        let lines = ([line] + logView.text.split(separator: "\n").map(String.init)).prefix(60)
        logView.text = lines.joined(separator: "\n")
        NSLog("[PMC Recognition] %@", text)
    }

    @objc private func closeTapped() {
        relay.disconnect()
        camera.stop()
        dismiss(animated: true)
    }
}

// MARK: - Small views

final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}

final class StatusRow: UIStackView {
    private let dot = UIView()
    private let label = UILabel()
    private let title: String

    init(title: String) {
        self.title = title
        super.init(frame: .zero)
        axis = .horizontal
        spacing = 8
        alignment = .center
        dot.layer.cornerRadius = 6
        dot.widthAnchor.constraint(equalToConstant: 12).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 12).isActive = true
        label.textColor = .white
        label.font = .systemFont(ofSize: 16)
        addArrangedSubview(dot)
        addArrangedSubview(label)
        set("...", color: .gray)
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func set(_ text: String, color: UIColor) {
        label.text = title + ": " + text
        dot.backgroundColor = color
    }
}
