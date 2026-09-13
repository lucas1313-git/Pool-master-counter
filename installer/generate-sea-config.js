// Build-time only (never runs in the packaged binary). Walks the repo's
// static app files and writes installer/generated/sea-config.json with an
// "assets" map - Node SEA's native way to embed arbitrary files into a
// single-executable binary, retrievable at runtime via node:sea's
// getAsset()/getAssetKeys() (see standalone-entry.js). Run from inside
// installer/, after the esbuild bundle step (this config's "main" points
// at the bundle it produces).
var fs = require("fs");
var path = require("path");

var REPO_ROOT = path.resolve(__dirname, "..");
var STATIC_ROOTS = ["css", "js", "languages", "icons"];
var STATIC_FILES = ["index.html", "manifest.json"];

var assets = {};

function addFile(repoRelativePath) {
  var abs = path.join(REPO_ROOT, repoRelativePath);
  // Use forward slashes for the asset key regardless of build OS, since
  // it's matched against req.path (always forward-slash) at runtime.
  var key = repoRelativePath.split(path.sep).join("/");
  assets[key] = abs;
}

function walk(dirRelativePath) {
  var absDir = path.join(REPO_ROOT, dirRelativePath);
  fs.readdirSync(absDir, { withFileTypes: true }).forEach(function (entry) {
    var childRelative = dirRelativePath + "/" + entry.name;
    if (entry.isDirectory()) {
      walk(childRelative);
    } else if (entry.isFile()) {
      addFile(childRelative);
    }
  });
}

STATIC_FILES.forEach(addFile);
STATIC_ROOTS.forEach(walk);

var seaConfig = {
  main: "generated/bundle.js",
  output: "generated/sea-prep.blob",
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: assets,
};

var outDir = path.join(__dirname, "generated");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "sea-config.json"), JSON.stringify(seaConfig, null, 2) + "\n");

console.log("Wrote installer/generated/sea-config.json with " + Object.keys(assets).length + " embedded assets.");
