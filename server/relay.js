// Wires up the WebSocket relay protocol on an existing http.Server.
// Returns the WebSocket.Server instance without attaching an "error"
// listener - callers attach their own, since EADDRINUSE should behave
// differently per entry point (server.js: print a friendly CLI message
// and exit; the standalone desktop build: just open the browser to the
// already-running instance instead of crashing).
function attachRelay(httpServer, WebSocket) {
  var wss = new WebSocket.Server({ server: httpServer, path: "/ws" });

  // Single global session per running process - one room, no auth. Good
  // enough for "one table, one relay" - running a second table just means
  // starting a second process on a different port.
  var hostSocket = null;
  var guestSockets = new Set();
  var lastSnapshot = null;

  function send(ws, msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function broadcastToGuests(msg) {
    guestSockets.forEach(function (ws) {
      send(ws, msg);
    });
  }

  function notifyGuestCount() {
    send(hostSocket, { type: "guest-count", count: guestSockets.size });
  }

  function notifyHostStatus(connected) {
    broadcastToGuests({ type: "host-status", connected: connected });
  }

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
        ws.role = msg.role === "host" ? "host" : "guest";
        if (ws.role === "host") {
          // A fresh host connection always wins over a stale one - this is
          // what makes "host's phone locked/backgrounded, then reopened"
          // self-healing without any extra client-side negotiation.
          hostSocket = ws;
          notifyGuestCount();
          notifyHostStatus(true);
        } else {
          guestSockets.add(ws);
          if (lastSnapshot) send(ws, lastSnapshot);
          send(ws, { type: "host-status", connected: !!hostSocket });
          notifyGuestCount();
        }
        return;
      }

      if (msg.type === "state" && ws.role === "host") {
        lastSnapshot = msg;
        broadcastToGuests(msg);
        return;
      }

      if (msg.type === "action" && ws.role === "guest") {
        send(hostSocket, msg);
        return;
      }
    });

    ws.on("close", function () {
      if (ws === hostSocket) {
        hostSocket = null;
        notifyHostStatus(false);
      }
      if (guestSockets.has(ws)) {
        guestSockets.delete(ws);
        notifyGuestCount();
      }
    });
  });

  return wss;
}

module.exports = { attachRelay: attachRelay };
