#!/bin/bash
# Contents/MacOS/PoolMasterCounter - the .app bundle's main executable
# (CFBundleExecutable in Info.plist). A GUI app bundle launched via Finder
# gets no visible window and no console by default, but this app is a
# server people need to see running (and know how to stop) while hosting
# a Group Session - so instead of running PoolMasterCounterServer
# directly, this opens it in a visible Terminal window, matching the
# "keep this window open while hosting" messaging already baked into the
# server's own startup output (see installer/standalone-entry.js).
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
osascript <<OSA
tell application "Terminal"
  activate
  do script "\"$DIR/PoolMasterCounterServer\""
end tell
OSA
