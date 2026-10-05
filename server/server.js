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
var https = require("https");
var fs = require("fs");
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
var cameraRelay = require("./camera-relay");

var PORT = process.env.PORT || 4173;
var REPO_ROOT = path.resolve(__dirname, "..");

var app = express();
app.use(express.static(REPO_ROOT, { extensions: ["html"] }));

// HTTPS is a hard precondition for the camera-recognition page, not
// polish - iOS Safari refuses getUserMedia() entirely over plain HTTP on
// anything but localhost. Off by default (Group Session itself doesn't
// need it); point SSL_CERT_PATH/SSL_KEY_PATH at an mkcert-issued cert/key
// to turn it on. See server/README.md for how to generate one with a LAN
// IP or mDNS hostname in its SAN, and how to trust it on an iPhone.
var SSL_CERT_PATH = process.env.SSL_CERT_PATH;
var SSL_KEY_PATH = process.env.SSL_KEY_PATH;
var httpServer;
var usingHttps = false;

if (SSL_CERT_PATH && SSL_KEY_PATH) {
  try {
    httpServer = https.createServer(
      { cert: fs.readFileSync(SSL_CERT_PATH), key: fs.readFileSync(SSL_KEY_PATH) },
      app
    );
    usingHttps = true;
  } catch (e) {
    console.error("Could not read SSL_CERT_PATH/SSL_KEY_PATH:", e.message);
    console.error("Falling back to plain HTTP - the camera recognition page will not work on iOS Safari.");
    httpServer = http.createServer(app);
  }
} else {
  httpServer = http.createServer(app);
  console.warn("Running over plain HTTP - the camera recognition page (camera.html) needs HTTPS");
  console.warn("to use the camera on iOS Safari. Set SSL_CERT_PATH and SSL_KEY_PATH to an");
  console.warn("mkcert-issued cert/key to enable it. See server/README.md.");
}

// Called after usingHttps is settled (not before, like a stray earlier
// placement of this call would be) - the camera setup wizard's /api/lan-info
// read needs this to reflect real state, not a value captured before it was
// known.
routes.attachApiRoutes(app, PORT, QRCode, function () {
  return usingHttps ? PORT : null;
});

var wss = relay.attachRelay(httpServer, WebSocket);
// Independent of the Group Session relay above - see camera-relay.js's
// own comment on why this is a second WebSocket.Server on its own path
// rather than a third role folded into relay.js's existing one.
var cameraWss = cameraRelay.attachCameraRelay(httpServer, WebSocket);

// Both relays above are built with { noServer: true }, so neither
// auto-attaches to httpServer's "upgrade" event - we dispatch by path
// ourselves, calling handleUpgrade() on exactly one of them per request.
// (See relay.js's own comment: letting ws auto-attach both would mean
// whichever one doesn't match a given request's path aborts it with an
// HTTP 400 before the matching one ever gets a chance.)
httpServer.on("upgrade", function (req, socket, head) {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, function (ws) {
      wss.emit("connection", ws, req);
    });
  } else if (req.url === "/ws-camera") {
    cameraWss.handleUpgrade(req, socket, head, function (ws) {
      cameraWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// { noServer: true } also means neither wss forwards httpServer's own
// "error" event (e.g. EADDRINUSE) to itself anymore - listen on
// httpServer directly instead.
httpServer.on("error", function (err) {
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
  var scheme = usingHttps ? "https" : "http";
  var addresses = lan.lanAddresses();
  console.log("Pool Master Counter group-session server running on port " + PORT + (usingHttps ? " (HTTPS)" : ""));
  if (addresses.length === 0) {
    console.log("No LAN network interface found - connect to WiFi first.");
    return;
  }
  console.log("Host this device at:");
  addresses.forEach(function (addr) {
    console.log("  " + scheme + "://" + addr + ":" + PORT + "/");
  });
  console.log("Others join at (or scan the QR on the Group Session page):");
  addresses.forEach(function (addr) {
    console.log("  " + scheme + "://" + addr + ":" + PORT + "/?join=1");
  });
  if (usingHttps) {
    console.log("Camera recognition page:");
    addresses.forEach(function (addr) {
      console.log("  " + scheme + "://" + addr + ":" + PORT + "/camera.html");
    });
  }
});
