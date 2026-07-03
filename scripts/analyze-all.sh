#!/bin/bash
# Run the full local library analysis outside the GUI.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
E="$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$E" ] || E="/Applications/Akasi Sounds.app/Contents/MacOS/Akasi Sounds"
exec env ELECTRON_RUN_AS_NODE=1 "$E" "$DIR/scripts/analyze-all.js"
