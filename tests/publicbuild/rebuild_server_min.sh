#!/bin/zsh
# Like rebuild_server.sh, but the PMCServerTest app (4173/4174) serves the MINIFIED public build
# (publicbuild/site, made by build-public.js) instead of the repo's own files - to try the
# minified app with this machine's real data. rebuild_server.sh puts the plain one back.
set -e
SB=/Users/lucmartin/Pool-master-counter/tests/publicbuild
DC=/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/devcert
N24=/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/node-v24.21.0-darwin-arm64/bin/node
SITE=$SB/site
node $SB/build-public.js /Users/lucmartin/Pool-master-counter $SITE
cd /Users/lucmartin/Pool-master-counter/installer
npx esbuild standalone-entry.js --bundle --platform=node --target=node24 --external:bufferutil --external:utf-8-validate --outfile=generated/bundle.js --log-level=warning
# the same asset list as generate-sea-config.js, taken from the minified site
$N24 -e '
const fs = require("fs"), path = require("path");
const site = process.argv[1], assets = {};
const add = (rel) => { assets[rel] = path.join(site, rel); };
const walk = (rel) => fs.readdirSync(path.join(site, rel), { withFileTypes: true }).forEach((e) => { const r = rel + "/" + e.name; if (e.isDirectory()) walk(r); else if (e.isFile()) add(r); });
["index.html", "manifest.json", "camera.html"].forEach(add);
["css", "js", "languages", "icons", "camera"].forEach(walk);
fs.mkdirSync("generated", { recursive: true });
fs.writeFileSync("generated/sea-config.json", JSON.stringify({ main: "generated/bundle.js", output: "generated/sea-prep.blob", disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2) + "\n");
console.log("sea-config: " + Object.keys(assets).length + " minified assets");
' $SITE
$N24 --experimental-sea-config generated/sea-config.json
cp $N24 $SB/PMCServerTest.new
codesign --remove-signature $SB/PMCServerTest.new
npx postject $SB/PMCServerTest.new NODE_SEA_BLOB generated/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA >/dev/null
codesign --sign - --force $SB/PMCServerTest.new
pkill -f "\./PMCServerTest" || true
sleep 1
mv $SB/PMCServerTest.new $DC/PMCServerTest
cd $DC && (PATH=$SB/noopen:$PATH nohup ./PMCServerTest > server.log 2>&1 &)
sleep 3
lsof -nP -iTCP -sTCP:LISTEN | grep -E ":4173|:4174"
