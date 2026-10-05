// Entry point for the bundled, standalone desktop build. Not used by the
// normal `cd server && npm start` dev flow (that's server/server.js,
// unchanged) - this is what gets esbuild-bundled and injected into a
// packaged Node binary via the Single Executable Applications feature.
//
// Static files are served from assets embedded in the binary itself
// (via node:sea's getAsset/getAssetKeys - see generate-sea-config.js for
// how those get embedded) instead of from disk, since there's no repo
// checkout on the end user's machine at all. The app has no server-side
// routing of its own - every screen is a client-side hash fragment
// (#leaderboard, #group-session, ...) that never reaches the server - so
// unlike a typical SPA server there's no need for a catch-all fallback to
// index.html; an exact asset-key match (with "/" mapped to "index.html")
// is the whole story, same as what express.static effectively does today.
var http = require("http");
var https = require("https");
var path = require("path");
var fs = require("fs");
var os = require("os");
var childProcess = require("child_process");
var sea = require("node:sea");
var deps = require("../server/deps.js");
var routes = require("../server/routes.js");
var relay = require("../server/relay.js");
var cameraRelay = require("../server/camera-relay.js");
var lan = require("../server/lan.js");
var tlsCert = require("../server/tls-cert.js");

// Number(), not just `|| 4173` - process.env.PORT is a string, and
// HTTPS_PORT below does real arithmetic on this (PORT + 1), which would
// silently string-concatenate ("4190" + 1 === "41901") instead of adding
// if PORT were left as a string - confirmed by actually hitting this bug
// in a real build before this line was added.
var PORT = Number(process.env.PORT) || 4173;
// Separate port for the HTTPS-only listener (camera.html needs a secure
// context for getUserMedia - see tls-cert.js's own comment). Kept apart
// from PORT entirely, rather than switching PORT itself to HTTPS, so
// ordinary local/LAN use (Group Session, just scoring on this machine)
// never changes at all - no new certificate warning for the vast
// majority of users who never touch the camera feature.
var HTTPS_PORT = PORT + 1;
var app = deps.express();

var ASSET_KEYS = sea.getAssetKeys();

app.get("*", function (req, res, next) {
  var key = decodeURIComponent(req.path.replace(/^\//, "")) || "index.html";
  if (ASSET_KEYS.indexOf(key) === -1) {
    next();
    return;
  }
  res.type(path.extname(key) || ".html");
  res.send(Buffer.from(sea.getAsset(key)));
});

routes.attachApiRoutes(app, PORT, deps.QRCode);

// One shared camera-relay instance, attached to BOTH servers below, so a
// camera connected via HTTPS and a tablet listener connected via plain
// HTTP land in the same listenerSockets/cameraSockets/enrollments state -
// see camera-relay.js's own comment on why two independent
// attachCameraRelay() calls would otherwise leave them unable to reach
// each other at all.
var cameraRelayShared = cameraRelay.createCameraRelay(deps.WebSocket);

var httpServer = http.createServer(app);
var wss = relay.attachRelay(httpServer, deps.WebSocket);
var cameraWssHttp = cameraRelayShared.attachToServer(httpServer);

// Both are built with { noServer: true } - see relay.js's own comment on
// why - so dispatch "upgrade" by path ourselves, same as server.js.
httpServer.on("upgrade", function (req, socket, head) {
  if (req.url === "/ws") {
    wss.handleUpgrade(req, socket, head, function (ws) {
      wss.emit("connection", ws, req);
    });
  } else if (req.url === "/ws-camera") {
    cameraWssHttp.handleUpgrade(req, socket, head, function (ws) {
      cameraWssHttp.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

attachListeners(httpServer, false);

// HTTPS with an auto-generated self-signed cert (see tls-cert.js's own
// comment on why this build gets a self-signed cert while server/server.js
// uses SSL_CERT_PATH/SSL_KEY_PATH instead), on its own port - this is what
// lets the camera recognition page work from this build with zero setup.
// Cert generation is async, so this listener starts up a beat after the
// primary one above, which doesn't depend on it at all.
tlsCert.getOrCreateCert(deps.selfsigned, lan.lanAddresses()).then(function (pems) {
  var httpsServer = https.createServer({ cert: pems.cert, key: pems.key }, app);
  // Only /ws-camera needs to exist here - Group Session guests/hosts
  // always use the plain HTTP server above, never this one.
  var cameraWssHttps = cameraRelayShared.attachToServer(httpsServer);
  httpsServer.on("upgrade", function (req, socket, head) {
    if (req.url === "/ws-camera") {
      cameraWssHttps.handleUpgrade(req, socket, head, function (ws) {
        cameraWssHttps.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });
  attachListeners(httpsServer, true);
}).catch(function (err) {
  console.error("Could not generate a local HTTPS certificate:", err.message);
  console.error("The camera recognition page will not work this run.");
});

function openBrowser(url) {
  var cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    childProcess.spawn(cmd, [url], { shell: process.platform === "win32", stdio: "ignore", detached: true }).unref();
  } catch (e) {
    console.log("Open this in your browser: " + url);
  }
}

// The web app's "Download & Take My Setup" flow (see
// downloadSetupForMultiTableHost in js/app.js) is a completely normal
// full backup export, just saved under this fixed name (instead of the
// usual timestamped one) with a pendingWizardStep field stamped onto it -
// dropped into the browser's default Downloads folder right before also
// downloading this app's own installer. There's no other channel to hand
// this app a parameter at launch at all, since it's a static signed
// binary shared by every download - a file left on disk under a name
// this app knows to look for is the only option.
var HANDOFF_FILENAME = "pool-master-counter-handoff.json";

function consumePendingHandoffStep() {
  try {
    var downloadsDir = path.join(os.homedir(), "Downloads");
    var handoffPath = path.join(downloadsDir, HANDOFF_FILENAME);
    if (!fs.existsSync(handoffPath)) return null;
    var parsed = JSON.parse(fs.readFileSync(handoffPath, "utf8"));
    var step = parsed && parsed.pendingWizardStep === "wizardLeague" ? "wizardLeague" : "wizardGame";
    // Renamed, not deleted - it's the organizer's real backup data, still
    // needed for the manual "pick a file" step the import prompt itself
    // triggers, so it must stay on disk. Renaming (instead of leaving the
    // fixed name in place) frees that name back up so a later, unrelated
    // launch of the app doesn't keep re-triggering this same prompt.
    try {
      fs.renameSync(handoffPath, path.join(downloadsDir, "pool-master-counter-backup-" + Date.now() + ".json"));
    } catch (renameErr) {
      // Non-fatal - worst case the fixed name lingers and this prompt
      // fires once more on the next launch.
    }
    return step;
  } catch (e) {
    return null;
  }
}

function startUrl() {
  var pendingStep = consumePendingHandoffStep();
  return "http://localhost:" + PORT + "/" + (pendingStep ? "?loadsetting=true&settingStep=" + pendingStep : "");
}

// isHttps: the primary plain-HTTP server (false) is "is the app already
// running" and opens the operator's browser on success; the HTTPS one
// (true) is a quieter second listener - its own EADDRINUSE isn't "the
// app is already running" (that's already been established by the
// primary server above), just a port conflict worth logging.
function attachListeners(httpServer, isHttps) {
  // { noServer: true } means wss no longer forwards httpServer's own
  // "error" event to itself - listen on httpServer directly instead.
  httpServer.on("error", function (err) {
    if (!isHttps && err.code === "EADDRINUSE") {
      // Already running (e.g. this app was double-clicked twice) - just open
      // the browser to the existing instance instead of showing an error.
      console.log("Pool Master Counter is already running - opening your browser...");
      openBrowser(startUrl());
      return;
    }
    if (isHttps) {
      console.error("Could not start the HTTPS listener (camera recognition page won't work):", err.message);
      return;
    }
    console.error("Could not start Pool Master Counter:", err.message);
    process.exit(1);
  });

  if (isHttps) {
    httpServer.listen(HTTPS_PORT, function () {
      var addresses = lan.lanAddresses();
      if (addresses.length > 0) {
        console.log("For the camera recognition page, open this on the phone watching the table:");
        addresses.forEach(function (addr) {
          console.log("  https://" + addr + ":" + HTTPS_PORT + "/camera.html");
        });
        console.log("(Safari will warn the certificate isn't trusted - that's expected for a");
        console.log("self-signed cert generated just for this machine; tap through it once.)");
      }
    });
    return;
  }

  httpServer.listen(PORT, function () {
    console.log("Pool Master Counter is running at http://localhost:" + PORT + "/");
    console.log("Keep this window open while hosting a Group Session.");
    openBrowser(startUrl());
  });
}
