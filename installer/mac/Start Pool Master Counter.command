#!/bin/bash
# A bare Unix executable can't reliably be double-clicked in Finder (no
# app bundle, no recognized file type) - a .command file is macOS's actual
# "double-click to run in Terminal" convention, so this thin wrapper is
# what the zip tells people to open, not the PoolMasterCounter binary
# directly.
cd "$(dirname "$0")"
./PoolMasterCounter
