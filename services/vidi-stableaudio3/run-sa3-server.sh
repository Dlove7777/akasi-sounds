#!/usr/bin/env bash
# Launch the Stable Audio 3 sync server inside WSL2 on VIDI. Run:  bash run-sa3-server.sh
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
ROOT="$HOME/stable-audio-3"
cd "$ROOT"

# server.py must live in the repo dir so `import stable_audio_3` resolves in the uv env.
[ -f "$ROOT/server.py" ] || { echo "ERROR: copy server.py into $ROOT first"; exit 1; }
[ -n "${HF_TOKEN:-}" ] || echo "WARN: HF_TOKEN not set - the gated model download will 401 on first /generate"

export SA3_HOST=0.0.0.0 SA3_PORT=8005
echo "[sa3-run] starting Stable Audio 3 server on 0.0.0.0:8005 (first /generate downloads weights)"
uv run python server.py
