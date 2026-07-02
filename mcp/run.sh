#!/bin/bash
# Launch the Akasi Sounds MCP door under the app's Electron ABI (matches the
# native better-sqlite3 build). Point your MCP client's command at this script.
#
# Uses the REAL Electron binary (a native executable) rather than the node_modules
# .bin/electron shim, which needs `node` on PATH — absent over non-interactive SSH,
# which is how Hermes on M1 reaches this door on M5.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
for E in \
  "$DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "/Applications/Akasi Sounds.app/Contents/MacOS/Akasi Sounds"; do
  [ -x "$E" ] && ELECTRON="$E" && break
done
[ -n "$ELECTRON" ] || { echo "no Electron binary found for MCP door" >&2; exit 1; }
exec env ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$DIR/mcp/server.js"
