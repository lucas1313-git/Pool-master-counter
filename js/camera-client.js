// Camera-based player recognition - tablet-side listener. Deliberately a
// separate file from js/app.js (not merged into that 30,000-line IIFE)
// so this feature can be updated/replaced on its own, per explicit
// request. The ONLY touchpoint with the rest of the app is
// window.PMCCameraBridge (defined at the very end of js/app.js) - this
// file never reaches into app.js any other way.
//
// Connects to the relay's /ws-camera endpoint (see server/camera-relay.js)
// as role "listener". On a "player_up" message, if it names a different
// player than the one currently selected on the keypad, switches the
// selection directly (no confirm/dismiss step, per explicit request) -
// exactly as if that player's number had been pressed on the physical
// keypad, so all the normal switch-sound/speech/highlight feedback
// already happens for free through PMCCameraBridge.selectPlayer.
(function () {
  "use strict";

  var WS_PATH = "/ws-camera";
  var RECONNECT_DELAY_MS = 3000;
  // Polls the on/off toggle rather than needing js/app.js to push a
  // "settings changed" event - the two files share no event bus by
  // design (see PMCCameraBridge's own comment), so this is the simplest
  // way to react to the camera-input checkbox being flipped at runtime
  // without enlarging that bridge any further. Also what keeps this file
  // from ever opening a WebSocket at all for the overwhelming majority
  // of users who never turn this feature on - connecting is deliberately
  // gated on the toggle, not attempted unconditionally on every page load.
  var POLL_ENABLED_MS = 3000;

  var ws = null;
  var reconnectTimer = null;
  var turnConfirmedRegistered = false;
  var ballFeedbackRegistered = false;
  var rosterSyncRegistered = false;

  function bridgeReady() {
    return !!window.PMCCameraBridge;
  }

  // Gameplay-driven auto-enrollment: forwards a human-confirmed score
  // change (see js/app.js's adjustScore) to the camera as stronger ground
  // truth than its own self-match. Registered through the poll loop below
  // rather than a bare one-time call at load, since script load order
  // between this file and js/app.js's IIFE isn't guaranteed - the bridge
  // may not exist yet the instant this file runs.
  function sendTurnConfirmed(playerName) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "turn_confirmed", player_name: playerName }));
    } catch (e) {}
  }

  // Ball tracking (Straight Pool): the camera's between-shots inventory
  // events go to the bridge, and the keypad's corrections come back the
  // same way turn_confirmed does.
  function handleBallEvent(msg) {
    if (!bridgeReady() || typeof window.PMCCameraBridge.reportBallEvent !== "function") return;
    window.PMCCameraBridge.reportBallEvent(msg);
  }
  function sendBallFeedback(feedback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: "ball_feedback", kind: feedback.kind, delta: feedback.delta, ts: feedback.ts }));
    } catch (e) {}
  }

  function wsUrl() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + WS_PATH;
  }

  function handlePlayerUp(msg) {
    if (!bridgeReady() || !window.PMCCameraBridge.isEnabled()) return;
    // selectPlayer (selectKeypadPlayer under the hood) has no overlay
    // guard of its own - without this, a camera event mid win-celebration
    // overlay would yank the selection and, in Focus Mode, smooth-scroll
    // the page out from under it.
    if (window.PMCCameraBridge.isAnyOverlayOpen()) return;
    // camera.html only ever knows players by name (see camera-relay.js's
    // own comment on why) - resolve that back to this session's real,
    // currently-live player id before doing anything else. An unresolved
    // name (player removed from the roster, or a typo during enrollment)
    // is silently ignored rather than guessed at.
    var id = window.PMCCameraBridge.resolvePlayerIdByName(msg.player_name);
    if (!id) return;
    // Only players actually in the game - someone enrolled but on Standby
    // (or just watching) must never grab the keypad or get announced.
    if (!window.PMCCameraBridge.isPlayerPlayingByName(msg.player_name)) return;
    // Selecting is skipped when this player is already selected, but
    // announcing is NOT behind that same check - see js/app.js's own
    // same-device listener for why: camera.html's debounceSec already
    // spaces out repeat player_up events for one name, so every one that
    // arrives here is a deliberate, legitimate shot that deserves its
    // own announcement, same player or not.
    if (id !== window.PMCCameraBridge.getSelectedPlayerId()) window.PMCCameraBridge.selectPlayer(id);
    window.PMCCameraBridge.announceShotFired(msg.player_name);
  }

  function handleSettingsRequest() {
    if (!bridgeReady() || !ws) return;
    var settings = window.PMCCameraBridge.getSettings();
    try {
      ws.send(JSON.stringify({ type: "settings", matchThreshold: settings.matchThreshold, debounceSec: settings.debounceSec }));
    } catch (e) {}
  }

  // camera.html's enroll picker uses this instead of free-text entry, so
  // a captured sample can never be mislabeled by a typo.
  function sendRoster(roster) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(roster || window.PMCCameraBridge.buildCameraRoster()));
    } catch (e) {}
  }
  function handleRosterRequest() {
    if (!bridgeReady() || !ws) return;
    sendRoster();
  }
  // A player sent to the graveyard - the relay drops their enrollment and
  // tells every camera.
  function sendEnrollDelete(playerName) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerName) return;
    try {
      ws.send(JSON.stringify({ type: "enroll-delete", player_name: playerName }));
    } catch (e) {}
  }

  // Live "who does the camera currently see" - distinct from
  // handlePlayerUp, which only reacts to an actual confirmed shot. Just
  // forwards straight into the bridge; nothing here needs to react to it
  // independently.
  function handleCandidateSeen(msg) {
    if (!bridgeReady()) return;
    window.PMCCameraBridge.reportCandidateSeen(msg.player_name || null, msg.stance, msg.angle, msg.closestName, msg.closestDistance, msg.matchThreshold, msg.rawPoseConfidence, msg.keypointConfFloor, msg.tooFarFromRail, msg.flashingName, msg.needsConfirmationName);
  }

  // Scorecard icon state (flashing/idle/+) for cross-device mode - same
  // messages same-device mode gets directly from the iframe, just over
  // the relay instead. See camera.html's own processIdlePoses/
  // notifyEnrollmentUpdated comments for what each payload carries.
  function handleIdleStates(msg) {
    if (!bridgeReady() || !window.PMCCameraBridge.reportIdleStates) return;
    window.PMCCameraBridge.reportIdleStates(Array.isArray(msg.idle) ? msg.idle : []);
  }
  function handleEnrollmentUpdated(msg) {
    if (!bridgeReady() || !window.PMCCameraBridge.reportEnrollmentUpdated || !msg.player_name) return;
    window.PMCCameraBridge.reportEnrollmentUpdated(msg.player_name);
  }

  // Remote calibration: lets the Players panel drive camera.html's own
  // manual-tap calibration from this (listener) device instead of
  // requiring anyone to touch the camera device - see
  // server/camera-relay.js's protocol comment for the message shapes.
  // Outbound sends are exposed as plain PMCCameraBridge methods (assigned
  // once bridgeReady, same guarded-registration pattern pollEnabled
  // already uses for onTurnConfirmed) rather than routed through a
  // registered callback, since - unlike turn_confirmed - nothing in
  // js/app.js needs to originate these on its own; they only ever fire
  // in direct response to a person interacting with the remote-calibration
  // overlay, so a plain callable is simpler than a registration slot.
  var remoteCalibMethodsRegistered = false;
  function registerRemoteCalibMethods() {
    window.PMCCameraBridge.startRemoteCalibration = function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "remote-calib-start" })); } catch (e) {}
    };
    window.PMCCameraBridge.cancelRemoteCalibration = function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "remote-calib-cancel" })); } catch (e) {}
    };
    window.PMCCameraBridge.sendRemoteCalibTap = function (fx, fy) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "remote-calib-tap", fx: fx, fy: fy })); } catch (e) {}
    };
    // Remote camera (lens) selection - independent of the calibration
    // start/cancel/tap trio above, same reasoning as camera-relay.js's
    // own comment: picking a lens is useful before framing/calibrating,
    // not only during it.
    window.PMCCameraBridge.requestRemoteCameraList = function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "remote-camera-list-request" })); } catch (e) {}
    };
    window.PMCCameraBridge.selectRemoteCamera = function (deviceId) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try { ws.send(JSON.stringify({ type: "remote-camera-select", deviceId: deviceId })); } catch (e) {}
    };
  }
  function handleCalibFrame(msg) {
    if (!bridgeReady() || !window.PMCCameraBridge.reportCalibFrame) return;
    window.PMCCameraBridge.reportCalibFrame({
      dataUrl: msg.dataUrl || null,
      step: msg.step || null,
      done: !!msg.done,
      failed: msg.failed || null
    });
  }
  function handleRemoteCameraList(msg) {
    if (!bridgeReady() || !window.PMCCameraBridge.reportRemoteCameraList) return;
    window.PMCCameraBridge.reportRemoteCameraList({
      devices: Array.isArray(msg.devices) ? msg.devices : [],
      currentDeviceId: msg.currentDeviceId || null
    });
  }


  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      if (bridgeReady() && window.PMCCameraBridge.isEnabled()) connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (ws) return;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      ws = null;
      scheduleReconnect();
      return;
    }
    ws.addEventListener("open", function () {
      try {
        ws.send(JSON.stringify({ type: "hello", role: "listener" }));
      } catch (e) {}
    });
    ws.addEventListener("message", function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (msg.type === "player_up") handlePlayerUp(msg);
      else if (msg.type === "settings-request") handleSettingsRequest();
      else if (msg.type === "roster-request") handleRosterRequest();
      else if (msg.type === "candidate") handleCandidateSeen(msg);
      else if (msg.type === "idle-states") handleIdleStates(msg);
      else if (msg.type === "enrollment-updated") handleEnrollmentUpdated(msg);
      else if (msg.type === "calib-frame") handleCalibFrame(msg);
      else if (msg.type === "remote-camera-list") handleRemoteCameraList(msg);
      else if (msg.type === "ball_pocketed" || msg.type === "ball_rerack" || msg.type === "ball_reappeared") handleBallEvent(msg);
    });
    ws.addEventListener("close", function () {
      ws = null;
      scheduleReconnect();
    });
    // No separate "error" handling needed - a WebSocket always fires
    // "close" right after "error", so the reconnect scheduled there
    // covers this too.
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch (e) {}
      ws = null;
    }
  }

  function pollEnabled() {
    if (!bridgeReady()) return;
    if (!turnConfirmedRegistered) {
      window.PMCCameraBridge.onTurnConfirmed(sendTurnConfirmed);
      turnConfirmedRegistered = true;
    }
    if (!ballFeedbackRegistered && typeof window.PMCCameraBridge.onBallFeedback === "function") {
      window.PMCCameraBridge.onBallFeedback(sendBallFeedback);
      ballFeedbackRegistered = true;
    }
    if (!rosterSyncRegistered && typeof window.PMCCameraBridge.onRosterChanged === "function") {
      window.PMCCameraBridge.onRosterChanged(sendRoster);
      window.PMCCameraBridge.onEnrollDelete(sendEnrollDelete);
      rosterSyncRegistered = true;
    }
    if (!remoteCalibMethodsRegistered) {
      registerRemoteCalibMethods();
      remoteCalibMethodsRegistered = true;
    }
    var enabled = window.PMCCameraBridge.isEnabled();
    if (enabled && !ws) connect();
    else if (!enabled && ws) disconnect();
  }

  setInterval(pollEnabled, POLL_ENABLED_MS);
  pollEnabled();
})();
