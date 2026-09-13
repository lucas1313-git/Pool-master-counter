// Local LAN relay for Pool Master Counter's "Group Session" feature.
//
// This server is deliberately dumb about pool rules - it only serves the
// existing static web app (unmodified) and relays JSON messages between
// one "host" browser tab and any number of "guest" tabs connected over
// WebSocket. The host keeps running the app's real game logic exactly as
// it does offline; it just also broadcasts its state after every save and
// executes a small whitelist of "please call this function" requests from
// guests. See js/app.js (networkMode/openRelayConnection/dispatchNetworkAction)
// for the client side of this protocol.
//
// LAN-only, no auth, no TLS - meant for a trusted local WiFi (e.g. a pool
// hall), not the public internet. Do not port-forward this.

var http = require("http");
var os = require("os");
var path = require("path");
var express = require("express");
var WebSocket = require("ws");
var QRCode = require("qrcode");

var PORT = process.env.PORT || 4173;
var REPO_ROOT = path.resolve(__dirname, "..");

var app = express();
app.use(express.static(REPO_ROOT, { extensions: ["html"] }));

app.get("/api/qr.png", function (req, res) {
  var url = req.query.url;
  if (!url) {
    res.status(400).send("Missing ?url=");
    return;
  }
  res.type("png");
  QRCode.toFileStream(res, url, { width: 320, margin: 1 });
});

var httpServer = http.createServer(app);
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

function lanAddresses() {
  var interfaces = os.networkInterfaces();
  var addresses = [];
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (iface) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    });
  });
  return addresses;
}

httpServer.listen(PORT, function () {
  var addresses = lanAddresses();
  console.log("Pool Master Counter group-session server running on port " + PORT);
  if (addresses.length === 0) {
    console.log("No LAN network interface found - connect to WiFi first.");
    return;
  }
  console.log("Host this device at:");
  addresses.forEach(function (addr) {
    console.log("  http://" + addr + ":" + PORT + "/");
  });
  console.log("Others join at (or scan the QR on the Group Session page):");
  addresses.forEach(function (addr) {
    console.log("  http://" + addr + ":" + PORT + "/?join=1");
  });
});
