#!/bin/bash
# Akasi Sounds AI sidecar setup — creates a self-contained Python venv.
# Torch has no Python 3.14 wheels yet, so this pins to 3.12/3.11.
set -e
cd "$(dirname "$0")"

PY=$(command -v python3.12 || command -v python3.11) || {
  echo "ERROR: python3.12 or python3.11 required (brew install python@3.12)"; exit 1; }

echo "Using $PY"
[ -d venv ] || "$PY" -m venv venv
./venv/bin/pip install --quiet --upgrade pip
# librosa: BPM/key DSP · torch+transformers: CLAP semantic embeddings
./venv/bin/pip install --quiet numpy librosa soundfile torch transformers
echo "OK — sidecar venv ready"
./venv/bin/python -c "import librosa, torch, transformers; print('librosa', librosa.__version__, '| torch', torch.__version__, '| transformers', transformers.__version__)"
