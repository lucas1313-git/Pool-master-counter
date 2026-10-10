#!/bin/zsh
# Rebuild the temp PMCServerTest (4173/4174) from the repo and restart it without opening a browser tab.
set -e
SB=/Users/lucmartin/Pool-master-counter/tests/publicbuild
DC=/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/devcert
N24=/private/tmp/claude-501/-Users-lucmartin/955cf1c9-ee76-47df-9aa6-1e62c9263742/scratchpad/node-v24.21.0-darwin-arm64/bin/node
cd /Users/lucmartin/Pool-master-counter/installer
npx esbuild standalone-entry.js --bundle --platform=node --target=node24 --external:bufferutil --external:utf-8-validate --outfile=generated/bundle.js --log-level=warning
$N24 generate-sea-config.js
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
