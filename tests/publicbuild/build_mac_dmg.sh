#!/bin/zsh
# Builds the macOS desktop app's .dmg on this Mac, the same way
# .github/workflows/build-desktop.yml does on GitHub: the server + the app's
# files as one Node 24 single executable, inside PoolMasterCounter.app, signed
# with the Developer ID certificate from this Mac's keychain - the app's files
# minified (tests/publicbuild/build-public.js), as the release branch carries them - (hardened runtime,
# for notarization), packed into a .dmg. Notarizing and publishing are separate
# steps (notarize_and_publish_dmg.sh) - they need Apple's API key.
# usage: tests/publicbuild/build_mac_dmg.sh   (from any directory) -> installer/generated/PoolMasterCounter-mac-arm64.dmg
set -e
REPO=/Users/lucmartin/Pool-master-counter
# Node 24, like the workflow (Node's single-executable support differs between versions)
N24=${N24:-/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/node-v24.21.0-darwin-arm64/bin/node}
IDENTITY="Developer ID Application: Luc Martin (UFAU7GCXKV)"
DMG=PoolMasterCounter-mac-arm64.dmg
[ -x "$N24" ] || { echo "Node 24 not found at $N24 - set N24=<path to a node v24 binary>"; exit 1; }
"$N24" -v | grep -q '^v24\.' || { echo "$N24 isn't Node 24"; exit 1; }

# (dependencies as already installed here; `npm ci` in server/ and installer/ the first time)
[ -d $REPO/server/node_modules ] || (cd $REPO/server && npm ci --silent)
[ -d $REPO/installer/node_modules ] || (cd $REPO/installer && npm ci --silent)
cd $REPO/installer
npx esbuild standalone-entry.js --bundle --platform=node --target=node24 \
  --external:bufferutil --external:utf-8-validate --outfile=generated/bundle.js --log-level=warning
# The app's files from the minified public copy (build-public.js), like the
# `release` branch's minified code the workflow builds from - the same asset
# list as generate-sea-config.js, taken from that copy.
SITE=$REPO/tests/publicbuild/site
node $REPO/tests/publicbuild/build-public.js $REPO $SITE
"$N24" -e '
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
"$N24" --experimental-sea-config generated/sea-config.json

APP=generated/PoolMasterCounter.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$N24" "$APP/Contents/MacOS/PoolMasterCounterServer"
codesign --remove-signature "$APP/Contents/MacOS/PoolMasterCounterServer"
npx postject "$APP/Contents/MacOS/PoolMasterCounterServer" NODE_SEA_BLOB generated/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA >/dev/null
chmod +x "$APP/Contents/MacOS/PoolMasterCounterServer"
cp mac/launch.sh "$APP/Contents/MacOS/PoolMasterCounter"
chmod +x "$APP/Contents/MacOS/PoolMasterCounter"
cp mac/Info.plist "$APP/Contents/Info.plist"

ICONSET=generated/AppIcon.iconset
rm -rf $ICONSET && mkdir -p $ICONSET
SRC=../icons/icon-512.png
for spec in 16:icon_16x16 32:icon_16x16@2x 32:icon_32x32 64:icon_32x32@2x 128:icon_128x128 256:icon_128x128@2x 256:icon_256x256 512:icon_256x256@2x 512:icon_512x512 1024:icon_512x512@2x; do
  sips -z ${spec%%:*} ${spec%%:*} $SRC --out $ICONSET/${spec#*:}.png >/dev/null
done
iconutil -c icns $ICONSET -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf $ICONSET

codesign --deep --force --sign "$IDENTITY" --options runtime --entitlements mac/entitlements.plist "$APP"
codesign --verify --deep --strict "$APP"

rm -rf generated/dmg-root
mkdir -p generated/dmg-root
cp -R "$APP" generated/dmg-root/
ln -s /Applications generated/dmg-root/Applications
rm -f generated/$DMG
hdiutil create -volname "Pool Master Counter" -srcfolder generated/dmg-root -ov -format UDZO generated/$DMG >/dev/null
rm -rf generated/dmg-root
ls -la generated/$DMG
