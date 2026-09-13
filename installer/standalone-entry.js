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
var childProcess = require("child_process");
var sea = require("node:sea");
var deps = require("../server/deps.js");
var routes = require("../server/routes.js");
var relay = require("../server/relay.js");

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

function openBrowser(url) {
  var cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    childProcess.spawn(cmd, [url], { shell: process.platform === "win32", stdio: "ignore", detached: true }).unref();
  } catch (e) {
    console.log("Open this in your browser: " + url);
  }
}

wss.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    // Already running (e.g. this app was double-clicked twice) - just open
    // the browser to the existing instance instead of showing an error.
    console.log("Pool Master Counter is already running - opening your browser...");
    openBrowser("http://localhost:" + PORT + "/");
    return;
  }
  console.error("Could not start Pool Master Counter:", err.message);
  process.exit(1);
});

httpServer.listen(PORT, function () {
  console.log("Pool Master Counter is running at http://localhost:" + PORT + "/");
  console.log("Keep this window open while hosting a Group Session.");
  openBrowser("http://localhost:" + PORT + "/");
});
