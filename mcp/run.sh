#!/bin/bash
# Launch the Akasi Sounds MCP door under the app's Electron ABI (matches the
# native better-sqlite3 build). Point your MCP client's command at this script.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"
[ -x "$ELECTRON" ] || ELECTRON="/Applications/Akasi Sounds.app/Contents/MacOS/Akasi Sounds"
exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$DIR/mcp/server.js"
