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
  function handleRosterRequest() {
    if (!bridgeReady() || !ws) return;
    try {
      ws.send(JSON.stringify({ type: "roster", names: window.PMCCameraBridge.getPlayerNames() }));
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
    var enabled = window.PMCCameraBridge.isEnabled();
    if (enabled && !ws) connect();
    else if (!enabled && ws) disconnect();
  }

  setInterval(pollEnabled, POLL_ENABLED_MS);
  pollEnabled();
})();
