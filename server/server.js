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

var lan = require("./lan");
var routes = require("./routes");
var relay = require("./relay");

var PORT = process.env.PORT || 4173;
var REPO_ROOT = path.resolve(__dirname, "..");

var app = express();
app.use(express.static(REPO_ROOT, { extensions: ["html"] }));

routes.attachApiRoutes(app, PORT, QRCode);

var httpServer = http.createServer(app);
var wss = relay.attachRelay(httpServer, WebSocket);

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
  var addresses = lan.lanAddresses();
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
