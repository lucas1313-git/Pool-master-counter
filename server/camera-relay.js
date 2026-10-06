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
//     { type: "roster-request" } (camera -> relay -> every "listener")
//     { type: "roster", names: [...] } (listener -> relay -> every "camera")
//   Gameplay-driven auto-enrollment (js/app.js's adjustScore hook, via
//   js/camera-client.js - see its own comment on why this is safe from
//   feedback loops): a human confirming a real score for a player is
//   stronger ground truth than the camera's own self-match, so camera.html
//   uses this to label (or relabel) its current candidate appearance:
//     { type: "turn_confirmed", player_name } (listener -> relay -> every "camera")
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
          ws.role = msg.role === "camera" ? "camera" : msg.role === "listener" ? "listener" : null;
          if (ws.role === "listener") listenerSockets.add(ws);
          if (ws.role === "camera") cameraSockets.add(ws);
          return;
        }

        if (msg.type === "player_up" && ws.role === "camera") {
          broadcastToListeners({ type: "player_up", player_name: msg.player_name, confidence: msg.confidence, ts: msg.ts });
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
            tooFarFromRail: msg.tooFarFromRail
          });
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

        // Same request/reply shape as settings-request/settings - lets
        // camera.html's enroll picker offer the tablet's real player
        // roster instead of free text (see js/camera-client.js's own
        // handleRosterRequest).
        if (msg.type === "roster-request" && ws.role === "camera") {
          broadcastToListeners({ type: "roster-request" });
          return;
        }

        if (msg.type === "roster" && ws.role === "listener" && Array.isArray(msg.names)) {
          broadcastToCameras({ type: "roster", names: msg.names });
          return;
        }

        if (msg.type === "turn_confirmed" && ws.role === "listener" && msg.player_name) {
          broadcastToCameras({ type: "turn_confirmed", player_name: msg.player_name });
          return;
        }
      });

      ws.on("close", function () {
        listenerSockets.delete(ws);
        cameraSockets.delete(ws);
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
