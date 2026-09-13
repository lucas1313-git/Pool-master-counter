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
var express, WebSocket, QRCode;
try {
  express = require("express");
  WebSocket = require("ws");
  QRCode = require("qrcode");
} catch (e) {
  console.error("Dependencies aren't installed yet.");
  console.error("Run this first, from inside the server/ folder:");
  console.error("  npm install");
  process.exit(1);
}

var PORT = process.env.PORT || 4173;
var REPO_ROOT = path.resolve(__dirname, "..");

var app = express();
app.use(express.static(REPO_ROOT, { extensions: ["html"] }));

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

// The host's browser needs to know its own LAN-reachable address to build
// a join URL/QR that a *different* device can actually use. It can't infer
// this from location.host - if the host opened the app via
// http://localhost:4173/ (the natural thing to type on the machine running
// this server), a join link built from that would tell every guest's phone
// to connect to its own localhost, which silently fails with no useful
// error. So the app fetches this instead of trusting its own origin.
app.get("/api/lan-info", function (req, res) {
  res.json({ addresses: lanAddresses(), port: PORT });
});

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

wss.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use.");
    console.error("Is the server already running in another terminal/tab?");
    console.error("Either close that one, or run this one on a different port:");
    console.error("  PORT=4174 npm start");
  } else {
    console.error("Could not start the server:", err.message);
  }
  process.exit(1);
});

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
