// A second, independent WebSocket relay for the camera-based player
// recognition feature - deliberately NOT folded into relay.js's existing
// "hello" handler. That handler hardcodes its role as a binary
// (`ws.role = msg.role === "host" ? "host" : "guest"`), so a third role
// added there would silently fall through to "guest" - inflating the
// Group Session host's own guest-count display and handing a camera
// connection full game-state snapshots it has no use for. Running on its
// own path ("/ws-camera") with its own tiny role model keeps the two
// features from ever being able to confuse one another, at the cost of
// one extra WebSocket.Server sharing the same underlying http(s) server.
//
// Built with { noServer: true } rather than { server: httpServer, path } -
// ws's own auto-attached "upgrade" listener aborts (HTTP 400) any request
// whose path doesn't match its own, which would otherwise race relay.js's
// listener on the same httpServer and kill /ws-camera connections before
// this server's handleUpgrade ever runs. The caller instead registers one
// shared "upgrade" listener that dispatches by path.
//
// Like relay.js, this takes WebSocket as a parameter rather than
// require()-ing it directly - see deps.js's own comment on why (esbuild's
// bundling for the standalone build needs the actual require() call to
// live inside server/, not here).
//
// Players are identified by NAME, not the tablet's internal player id
// (js/app.js's uid() - a session-local, date-based random string, by its
// own comment NOT meant to survive across devices/sessions; every other
// cross-device store in this app keys by name instead, same as here).
// camera.html never sees the tablet's real ids at all - js/camera-client.js
// is the side that resolves a recognized name back to a live player id,
// via the PMCCameraBridge.resolvePlayerIdByName() added for this purpose.
// Names are matched case-insensitively (normalizeNameKey below mirrors
// js/app.js's own normalizeNameKey) - two players with the same name at
// the same table is a known, accepted limitation of the "simplest"
// name-based option.
//
// Protocol:
//   { type: "hello", role: "camera" | "listener" }
//   camera -> relay -> broadcast to every "listener":
//     { type: "player_up", player_name, confidence, ts }
//     { type: "candidate", player_name, stance, angle, closestName,
//       closestDistance, matchThreshold } - live "who's currently seen"
//       plus the current upright/bent reading and the nearest enrolled
//       player regardless of whether that distance actually clears the
//       threshold (so "detecting fine but just over threshold" can be
//       told apart from "not detecting anyone"), sent every frame (not
//       just on change), independent of player_up (which only fires on
//       an actual confirmed shot)
//   Enrollment (per explicit request: additive, improves with use - each
//   player's enrollment is a growing LIST of descriptors, not one frozen
//   average):
//     { type: "enroll-save", player_name, descriptors: [...], side? }  - replaces
//     { type: "enroll-add", player_name, descriptor, side? }           - appends
//     { type: "enroll-get" }                                           - request
//     -> relay replies: { type: "enrollments", data: {...} }
//     { type: "enroll-delete", player_name }
//   The optional `side` (0-3) is which of the 4 calibrated table rails the
//   sample came from - see camera.html's own comment on why sides are
//   numbered by calibration tap order rather than camera-relative
//   near/far/left/right. Tracked per enrollment entry as `sides` (a list
//   of distinct side indices seen) purely so camera.html's "how many of
//   the 4 sides has this player been seen from" bootstrapping progress
//   survives a page reload - this relay still doesn't interpret what a
//   descriptor or a side number actually means.
//   Settings handoff (camera.html has no other way to learn the tablet's
//   configured threshold/debounce - see js/app.js's PMCCameraBridge.getSettings()):
//     { type: "settings-request" } (camera -> relay -> every "listener")
//     { type: "settings", matchThreshold, debounceSec } (listener -> relay
//       -> every "camera")
//   Roster handoff (camera.html's enroll picker needs the tablet's real
//   player names instead of free text - same request/reply shape as
//   settings above):
//     { type: "roster-request" } (camera or viewer -> relay -> every "listener")
//     { type: "roster", names: [...] } (listener -> relay -> every "camera" and every "viewer")
//   Gameplay-driven auto-enrollment (js/app.js's adjustScore hook, via
//   js/camera-client.js - see its own comment on why this is safe from
//   feedback loops): a human confirming a real score for a player is
//   stronger ground truth than the camera's own self-match, so camera.html
//   uses this to label (or relabel) its current candidate appearance:
//     { type: "turn_confirmed", player_name } (listener -> relay -> every "camera")
//   Ball tracking (Straight Pool - camera.html counts balls on the
//   calibrated table between shots):
//     { type: "ball_pocketed", count, scratch, objectRemaining, ts }
//       (camera -> relay -> every "listener"; scratch:true means the cue
//       ball is gone, count is then 0)
//     { type: "ball_rerack", count, objectRemaining, ts } and
//     { type: "ball_reappeared", count, objectRemaining, ts }
//       (camera -> listeners; informational, never a credit)
//     { type: "ball_feedback", kind: "false_positive" | "missed", delta, ts }
//       (listener -> relay -> every "camera"; a keypad correction right
//       after, or in place of, an automatic credit)
//   Capture settings (the tablet's Visual Scoring > Capture Settings):
//     { type: "camera-settings", settings: { key: value, ... } }
//       (listener -> cameras; camera.html applies and saves them)
//     { type: "camera-settings-request" } (listener -> cameras)
//     { type: "camera-settings-state", settings: {...} }
//       (camera -> listeners; what the camera is actually using)
//     { type: "camera-status", status: { link, models, camera } }
//       (camera -> listeners; its status lights, as codes)
//     { type: "camera-presence", cameras: N }
//       (relay -> listeners; on a listener's hello, and whenever a
//       camera connects or drops)
//   Cue stick over the table (camera.html's cue tracking):
//     { type: "cue_event", event: "detected" | "gone" | "shooter" |
//       "no-shooter", lengthIn?, player_name?, via?, resent?, ts }
//       (camera -> listeners; drives the tablet's Cue debug mode log/voice)
//   Remote calibration (listener drives camera.html's manual-tap table
//   calibration without touching the camera device itself):
//     { type: "remote-calib-start" } (listener -> relay -> every "camera")
//     { type: "remote-calib-cancel" } (listener -> relay -> every "camera")
//     { type: "remote-calib-tap", fx, fy } (listener -> relay -> every "camera") -
//       fx/fy are 0-1 fractions of the streamed frame image
//     { type: "calib-frame", dataUrl, step, done, failed } (camera -> relay
//       -> every "listener") - one downsampled JPEG still per tap, not a
//       live video stream
//   Remote camera (lens) selection - independent of remote calibration,
//   so a wide-angle lens (say) can be picked before framing/calibrating:
//     { type: "remote-camera-list-request" } (listener -> relay -> every "camera")
//     { type: "remote-camera-list", devices: [{deviceId, label}], currentDeviceId }
//       (camera -> relay -> every "listener")
//     { type: "remote-camera-select", deviceId } (listener -> relay -> every "camera")
//   Remote viewer (a THIRD role, "viewer" - see createCameraRelay's own
//   comment): a camera.html?viewer=1 instance forwards every click/change/
//   canvas-tap it isn't handling locally by element id; the real camera
//   executes it on its own identical DOM, so none of this needs per-
//   feature camera-side logic, just the passthrough below:
//     { type: "hello", role: "viewer" }
//     { type: "viewer-click", id } (viewer -> relay -> every "camera")
//     { type: "viewer-change", id, value, checked } (viewer -> relay -> every
//       "camera") - checked is only meaningful (and only sent) for a
//       checkbox; a checkbox's .value is always the fixed string "on"
//       regardless of its checked state, so that alone can't drive one
//     { type: "viewer-canvas-tap", fx, fy } (viewer -> relay -> every "camera")
//     { type: "viewer-frame", dataUrl, elements } (camera -> relay -> every
//       "viewer") - a composited still plus a snapshot of status
//       text/classes to mirror, sent on a fixed interval while any viewer
//       is connected
//     { type: "hello-viewer-connected" } / { type: "hello-viewer-disconnected" }
//       (relay -> every "camera") - told once when the first viewer joins
//       / the last one leaves, so a camera only streams while watched
//
// No auth, LAN-only, same trust model as relay.js.

var fs = require("fs");
var os = require("os");
var path = require("path");

// Capped per player so storage/compute stay bounded as "enroll-add"
// accumulates real-world samples over time - oldest sample drops first
// (FIFO), same idea as RATING_HISTORY_CAP elsewhere in this app.
var MAX_DESCRIPTORS_PER_PLAYER = 50;

// Not next to the binary/repo - installer/standalone-entry.js has no
// repo checkout on the end user's machine at all (see its own comment on
// why HANDOFF_FILENAME lives under os.homedir() instead), so this file
// needs a path that exists regardless of which entry point is running.
var ENROLLMENTS_DIR = path.join(os.homedir(), ".pool-master-counter");
var ENROLLMENTS_PATH = path.join(ENROLLMENTS_DIR, "camera-enrollments.json");

// Mirrors js/app.js's own normalizeNameKey exactly (trim + lowercase) -
// this is the app's existing convention for matching names everywhere
// else, not a new rule invented for this feature.
function normalizeNameKey(name) {
  return (name || "").trim().toLowerCase();
}

// Appends `side` (0-3) to entry.sides if given and not already present -
// never double-counts the same side twice.
function addSide(entry, side) {
  if (typeof side !== "number" || side < 0 || side > 3) return;
  entry.sides = entry.sides || [];
  if (entry.sides.indexOf(side) === -1) entry.sides.push(side);
}

function loadEnrollments() {
  try {
    return JSON.parse(fs.readFileSync(ENROLLMENTS_PATH, "utf8"));
  } catch (e) {
    return {};
  }
}

// Synchronous - enroll-save/enroll-delete are human-triggered (rare),
// and enroll-add fires at most once per confirmed recognition (already
// throttled client-side by the N-consecutive-frame gate and the normal
// recognition debounce) - no write queue needed at this frequency.
function saveEnrollments(data) {
  try {
    fs.mkdirSync(ENROLLMENTS_DIR, { recursive: true });
    fs.writeFileSync(ENROLLMENTS_PATH, JSON.stringify(data));
  } catch (e) {
    console.error("[camera-relay] Could not save enrollments:", e.message);
  }
}

// Builds the relay's state and message handling ONCE, independent of any
// particular http(s).Server - attachToServer(httpServer) can then be
// called more than once (e.g. the standalone build's plain-HTTP server
// for the tablet's own ws:// connection, and a second, HTTPS-only server
// for camera.html's wss:// connection - a secure context is required for
// getUserMedia, so that side can never just reuse the plain HTTP one).
// Without this split, each attachCameraRelay() call would create its own
// disconnected listenerSockets/cameraSockets/enrollments, and a camera on
// the HTTPS server could never reach a tablet listening on the HTTP one.
function createCameraRelay(WebSocket) {
  var listenerSockets = new Set();
  var cameraSockets = new Set();
  // A THIRD role, distinct from "listener" - a listener gets the normal
  // candidate/player_up/idle-states broadcasts meant for driving the
  // scoreboard during real play; a viewer is a full remote-control
  // instance of camera.html itself (camera.html?viewer=1), forwarding
  // clicks/changes to the real camera and receiving its own
  // "viewer-frame" stream back. Kept separate so a viewer connecting or
  // disconnecting doesn't affect (or get affected by) the scoreboard's
  // own listener connection, and so cameras only pay the cost of
  // streaming viewer-frame while someone's actually watching.
  var viewerSockets = new Set();
  var viewerFrameCount = 0; // TEMPORARY DIAGNOSTIC
  var enrollments = loadEnrollments();

  function send(ws, msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcastToListeners(msg) {
    listenerSockets.forEach(function (ws) {
      send(ws, msg);
    });
  }

  function broadcastToCameras(msg) {
    cameraSockets.forEach(function (ws) {
      send(ws, msg);
    });
  }

  function broadcastToViewers(msg) {
    viewerSockets.forEach(function (ws) {
      send(ws, msg);
    });
  }

  function attachToServer(httpServer) {
    var wss = new WebSocket.Server({ noServer: true });

    wss.on("connection", function (ws) {
      ws.role = null;

      ws.on("message", function (raw) {
        var msg;
        try {
          msg = JSON.parse(raw);
        } catch (e) {
          return;
        }

        if (msg.type === "hello") {
          ws.role = msg.role === "camera" ? "camera" : msg.role === "listener" ? "listener" : msg.role === "viewer" ? "viewer" : null;
          if (ws.role === "listener") {
            listenerSockets.add(ws);
            // How many camera phones are connected right now - the
            // tablet's camera status lights start from this.
            send(ws, { type: "camera-presence", cameras: cameraSockets.size });
          }
          if (ws.role === "camera") {
            cameraSockets.add(ws);
            broadcastToListeners({ type: "camera-presence", cameras: cameraSockets.size });
            // A camera connecting (or reconnecting) AFTER a viewer is
            // already watching previously never learned that - the
            // viewer-connected notice only fired at the moment the
            // viewer *count* went 0->1, which this camera could easily
            // have missed (a phone reconnect, or the viewer simply
            // opening first). Tell this one camera directly instead of
            // only ever broadcasting on the viewer's own arrival.
            if (viewerSockets.size > 0) send(ws, { type: "hello-viewer-connected" });
          }
          if (ws.role === "viewer") {
            var wasEmpty = viewerSockets.size === 0;
            viewerSockets.add(ws);
            if (wasEmpty) broadcastToCameras({ type: "hello-viewer-connected" });
          }
          console.log("[DEBUG] hello role=" + ws.role + " | cameras=" + cameraSockets.size + " listeners=" + listenerSockets.size + " viewers=" + viewerSockets.size + (msg.lastCloseDebug ? " | PREV CLOSE: " + msg.lastCloseDebug : ""));
          return;
        }

        if (msg.type === "player_up" && ws.role === "camera") {
          broadcastToListeners({ type: "player_up", player_name: msg.player_name, confidence: msg.confidence, ts: msg.ts });
          return;
        }

        // Ball tracking (Straight Pool) - the camera's between-shots
        // inventory changes. Fields copied explicitly, same as player_up.
        if (msg.type === "ball_pocketed" && ws.role === "camera") {
          broadcastToListeners({ type: "ball_pocketed", count: msg.count, scratch: !!msg.scratch, objectRemaining: msg.objectRemaining, ts: msg.ts });
          return;
        }
        if ((msg.type === "ball_rerack" || msg.type === "ball_reappeared") && ws.role === "camera") {
          broadcastToListeners({ type: msg.type, count: msg.count, objectRemaining: msg.objectRemaining, ts: msg.ts });
          return;
        }

        // Cue stick over the table: came out over the cloth ("detected"),
        // put away ("gone"), or put down to a shooter ("shooter").
        if (msg.type === "cue_event" && ws.role === "camera") {
          broadcastToListeners({ type: "cue_event", event: msg.event, lengthIn: msg.lengthIn, player_name: msg.player_name || null, via: msg.via, resent: !!msg.resent, ts: msg.ts });
          return;
        }

        // Live "who does the camera currently see" - distinct from
        // player_up, which only fires on an actual confirmed shot. Lets
        // a listener (the tablet) show this without waiting for a shot.
        // Every field past player_name passes through unchanged
        // (undefined if the sending camera.html predates them) - they're
        // diagnostic extras, not required for a listener's own fallback
        // name-only rendering.
        if (msg.type === "candidate" && ws.role === "camera") {
          broadcastToListeners({
            type: "candidate",
            player_name: msg.player_name || null,
            stance: msg.stance,
            angle: msg.angle,
            closestName: msg.closestName,
            closestDistance: msg.closestDistance,
            matchThreshold: msg.matchThreshold,
            rawPoseConfidence: msg.rawPoseConfidence,
            keypointConfFloor: msg.keypointConfFloor,
            tooFarFromRail: msg.tooFarFromRail,
            flashingName: msg.flashingName,
            needsConfirmationName: msg.needsConfirmationName
          });
          return;
        }

        // Scorecard icon state, same "camera -> relay -> every listener"
        // shape as "candidate" above, just a different payload shape -
        // see camera.html's own processIdlePoses/notifyEnrollmentUpdated
        // comments for what each carries.
        if (msg.type === "idle-states" && ws.role === "camera") {
          broadcastToListeners({ type: "idle-states", idle: Array.isArray(msg.idle) ? msg.idle : [] });
          return;
        }
        if (msg.type === "enrollment-updated" && ws.role === "camera" && msg.player_name) {
          broadcastToListeners({ type: "enrollment-updated", player_name: msg.player_name });
          return;
        }

        if (msg.type === "enroll-save" && msg.player_name) {
          var saveKey = normalizeNameKey(msg.player_name);
          if (!saveKey) return;
          // A full replace, matching "re-running capture replaces their
          // enrollment from scratch" - sides resets too (not carried over
          // from whatever entry existed before), since it describes
          // coverage of the descriptors being replaced, not of the player
          // in the abstract.
          var saveEntry = { displayName: String(msg.player_name).trim(), descriptors: (msg.descriptors || []).slice(-MAX_DESCRIPTORS_PER_PLAYER) };
          addSide(saveEntry, msg.side);
          enrollments[saveKey] = saveEntry;
          saveEnrollments(enrollments);
          send(ws, { type: "enrollments", data: enrollments });
          return;
        }

        if (msg.type === "enroll-add" && msg.player_name && msg.descriptor) {
          var addKey = normalizeNameKey(msg.player_name);
          if (!addKey) return;
          var entry = enrollments[addKey] || { displayName: String(msg.player_name).trim(), descriptors: [] };
          entry.descriptors.push(msg.descriptor);
          if (entry.descriptors.length > MAX_DESCRIPTORS_PER_PLAYER) {
            entry.descriptors = entry.descriptors.slice(entry.descriptors.length - MAX_DESCRIPTORS_PER_PLAYER);
          }
          addSide(entry, msg.side);
          enrollments[addKey] = entry;
          saveEnrollments(enrollments);
          return;
        }

        if (msg.type === "enroll-get") {
          send(ws, { type: "enrollments", data: enrollments });
          return;
        }

        if (msg.type === "enroll-delete" && msg.player_name) {
          delete enrollments[normalizeNameKey(msg.player_name)];
          saveEnrollments(enrollments);
          send(ws, { type: "enrollments", data: enrollments });
          // A deletion can come from the scoreboard (player sent to the
          // graveyard) - every camera has to drop that player too, not
          // just whoever asked.
          if (ws.role !== "camera") broadcastToCameras({ type: "enrollments", data: enrollments });
          return;
        }

        if (msg.type === "settings-request" && ws.role === "camera") {
          broadcastToListeners({ type: "settings-request" });
          return;
        }

        if (msg.type === "settings" && ws.role === "listener") {
          broadcastToCameras({ type: "settings", matchThreshold: msg.matchThreshold, debounceSec: msg.debounceSec });
          return;
        }

        // Capture settings, both ways: the tablet's Visual Scoring section
        // changes them (camera-settings, listener -> cameras) and asks what
        // they are (camera-settings-request); the camera reports what it's
        // actually using (camera-settings-state, camera -> listeners), on
        // connect and after every change.
        if (msg.type === "camera-settings" && ws.role === "listener" && msg.settings && typeof msg.settings === "object") {
          broadcastToCameras({ type: "camera-settings", settings: msg.settings });
          return;
        }
        if (msg.type === "camera-settings-request" && ws.role === "listener") {
          broadcastToCameras({ type: "camera-settings-request" });
          return;
        }
        if (msg.type === "camera-settings-state" && ws.role === "camera" && msg.settings && typeof msg.settings === "object") {
          broadcastToListeners({ type: "camera-settings-state", settings: msg.settings });
          return;
        }
        // The camera's three status lights (connection, models, camera),
        // as codes - the tablet shows the same lights in Visual Scoring.
        if (msg.type === "camera-status" && ws.role === "camera" && msg.status && typeof msg.status === "object") {
          broadcastToListeners({ type: "camera-status", status: { link: msg.status.link, models: msg.status.models, camera: msg.status.camera } });
          return;
        }

        // Same request/reply shape as settings-request/settings - lets
        // camera.html's enroll picker offer the tablet's real player
        // roster instead of free text (see js/camera-client.js's own
        // handleRosterRequest).
        if (msg.type === "roster-request" && (ws.role === "camera" || ws.role === "viewer")) {
          broadcastToListeners({ type: "roster-request" });
          return;
        }

        if (msg.type === "roster" && ws.role === "listener" && Array.isArray(msg.names)) {
          // playing = who is in the game right now (recognition is limited
          // to them), known = every player on the scoreboard's contact
          // sheet (enrollments for anyone else get pruned by the camera).
          var rosterMsg = { type: "roster", names: msg.names, playing: Array.isArray(msg.playing) ? msg.playing : null, known: Array.isArray(msg.known) ? msg.known : null };
          broadcastToCameras(rosterMsg);
          // A viewer (camera.html?viewer=1) runs the exact same
          // populateEnrollNameSelect() on receiving this - it needs the
          // real roster for its own Enroll tab dropdown too, independent
          // of whatever the real camera already has cached.
          broadcastToViewers(rosterMsg);
          return;
        }

        if (msg.type === "turn_confirmed" && ws.role === "listener" && msg.player_name) {
          broadcastToCameras({ type: "turn_confirmed", player_name: msg.player_name });
          return;
        }

        // Keypad correction after (or instead of) an automatic ball credit
        // - the camera adjusts how patient it is before the next credit.
        if (msg.type === "ball_feedback" && ws.role === "listener" && (msg.kind === "false_positive" || msg.kind === "missed")) {
          broadcastToCameras({ type: "ball_feedback", kind: msg.kind, delta: msg.delta, ts: msg.ts });
          return;
        }

        // Remote calibration: lets the listener (the scoreboard device)
        // drive camera.html's manual table-calibration flow without
        // anyone touching the camera device itself - built specifically
        // because getUserMedia and the calibration canvas both only
        // exist on the camera device, so there was previously no way to
        // do this except standing at the camera and tapping its screen.
        // camera.html streams a downsampled still of its own calibration
        // view back after each tap (see its own startRemoteCalibration
        // comment); the listener never gets live video, just a frame
        // per step, which keeps this cheap enough for the relay's plain
        // JSON-over-WebSocket transport.
        if (msg.type === "remote-calib-start" && ws.role === "listener") {
          broadcastToCameras({ type: "remote-calib-start" });
          return;
        }
        if (msg.type === "remote-calib-cancel" && ws.role === "listener") {
          broadcastToCameras({ type: "remote-calib-cancel" });
          return;
        }
        if (msg.type === "remote-calib-tap" && ws.role === "listener") {
          broadcastToCameras({ type: "remote-calib-tap", fx: msg.fx, fy: msg.fy });
          return;
        }
        if (msg.type === "calib-frame" && ws.role === "camera") {
          broadcastToListeners({ type: "calib-frame", dataUrl: msg.dataUrl, step: msg.step, done: !!msg.done, failed: msg.failed || null });
          return;
        }

        // Remote camera (lens) selection - same request/reply plus
        // listener-initiated-action shape as the pairs above. Kept
        // independent of remote-calib-start/cancel since picking a lens
        // is useful even when not actively calibrating.
        if (msg.type === "remote-camera-list-request" && ws.role === "listener") {
          broadcastToCameras({ type: "remote-camera-list-request" });
          return;
        }
        if (msg.type === "remote-camera-list" && ws.role === "camera") {
          broadcastToListeners({ type: "remote-camera-list", devices: Array.isArray(msg.devices) ? msg.devices : [], currentDeviceId: msg.currentDeviceId || null });
          return;
        }
        if (msg.type === "remote-camera-select" && ws.role === "listener" && msg.deviceId) {
          broadcastToCameras({ type: "remote-camera-select", deviceId: msg.deviceId });
          return;
        }

        // Generic remote-viewer transport - a camera.html?viewer=1
        // instance forwards every click/change/canvas-tap it isn't
        // handling locally (tab switches, help popups) verbatim by
        // element id; the real camera executes it on its own identical
        // DOM, so no camera-side logic needed per feature, just this
        // passthrough. viewer-frame is the matching one-way stream back.
        if (msg.type === "viewer-click" && ws.role === "viewer" && msg.id) {
          console.log("[DEBUG] viewer-click id=" + msg.id + " -> " + cameraSockets.size + " camera(s)");
          broadcastToCameras({ type: "viewer-click", id: msg.id });
          return;
        }
        if (msg.type === "viewer-change" && ws.role === "viewer" && msg.id) {
          console.log("[DEBUG] viewer-change id=" + msg.id + " value=" + msg.value + " checked=" + msg.checked + " -> " + cameraSockets.size + " camera(s)");
          broadcastToCameras({ type: "viewer-change", id: msg.id, value: msg.value, checked: msg.checked });
          return;
        }
        if (msg.type === "viewer-canvas-tap" && ws.role === "viewer" && typeof msg.fx === "number" && typeof msg.fy === "number") {
          console.log("[DEBUG] viewer-canvas-tap fx=" + msg.fx + " fy=" + msg.fy + " -> " + cameraSockets.size + " camera(s)");
          broadcastToCameras({ type: "viewer-canvas-tap", fx: msg.fx, fy: msg.fy });
          return;
        }
        if (msg.type === "viewer-frame" && ws.role === "camera") {
          viewerFrameCount++;
          if (viewerFrameCount === 1 || viewerFrameCount % 5 === 0) {
            console.log("[DEBUG] viewer-frame #" + viewerFrameCount + " dataUrl bytes=" + (msg.dataUrl ? msg.dataUrl.length : 0) + " -> " + viewerSockets.size + " viewer(s) | dotModels=" + (msg.elements && msg.elements.dotModels ? msg.elements.dotModels.cls : "?") + " dotCamera=" + (msg.elements && msg.elements.dotCamera ? msg.elements.dotCamera.cls : "?"));
          }
          broadcastToViewers({ type: "viewer-frame", dataUrl: msg.dataUrl, elements: msg.elements || {} });
          return;
        }

        // TEMPORARY DIAGNOSTIC: free-form client-side debug text, logged
        // server-side only - never broadcast anywhere.
        if (msg.type === "client-debug") {
          console.log("[CLIENT-DEBUG, role=" + ws.role + "] " + msg.text);
          return;
        }
      });

      ws.on("close", function () {
        listenerSockets.delete(ws);
        var wasCamera = cameraSockets.delete(ws);
        if (wasCamera) broadcastToListeners({ type: "camera-presence", cameras: cameraSockets.size });
        if (ws.role === "viewer") {
          viewerSockets.delete(ws);
          if (viewerSockets.size === 0) broadcastToCameras({ type: "hello-viewer-disconnected" });
        }
      });
    });

    return wss;
  }

  return { attachToServer: attachToServer };
}

// Single-server convenience wrapper - what server/server.js uses (it only
// ever has one httpServer, so there's no shared-state need). The
// standalone build calls createCameraRelay() directly instead, so it can
// attach the one shared relay to two servers - see that function's own
// comment on why.
function attachCameraRelay(httpServer, WebSocket) {
  return createCameraRelay(WebSocket).attachToServer(httpServer);
}

module.exports = { attachCameraRelay: attachCameraRelay, createCameraRelay: createCameraRelay };
