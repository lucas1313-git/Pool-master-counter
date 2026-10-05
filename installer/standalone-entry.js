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
var path = require("path");
var fs = require("fs");
var os = require("os");
var childProcess = require("child_process");
var sea = require("node:sea");
var deps = require("../server/deps.js");
var routes = require("../server/routes.js");
var relay = require("../server/relay.js");
var cameraRelay = require("../server/camera-relay.js");

var PORT = process.env.PORT || 4173;
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

var httpServer = http.createServer(app);
var wss = relay.attachRelay(httpServer, deps.WebSocket);
var cameraWss = cameraRelay.attachCameraRelay(httpServer, deps.WebSocket);

// Both relays are built with { noServer: true } - see relay.js's own
// comment on why - so dispatch "upgrade" by path ourselves, same as
// server.js.
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

// { noServer: true } means wss no longer forwards httpServer's own
// "error" event to itself - listen on httpServer directly instead.
httpServer.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    // Already running (e.g. this app was double-clicked twice) - just open
    // the browser to the existing instance instead of showing an error.
    console.log("Pool Master Counter is already running - opening your browser...");
    openBrowser(startUrl());
    return;
  }
  console.error("Could not start Pool Master Counter:", err.message);
  process.exit(1);
});

httpServer.listen(PORT, function () {
  console.log("Pool Master Counter is running at http://localhost:" + PORT + "/");
  console.log("Keep this window open while hosting a Group Session.");
  openBrowser(startUrl());
});
