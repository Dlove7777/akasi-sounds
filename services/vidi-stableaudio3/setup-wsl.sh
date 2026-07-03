#!/usr/bin/env bash
# Stable Audio 3 Medium setup INSIDE WSL2 Ubuntu on VIDI (CUDA passthrough to the 4070).
# This is where flash-attn "just works" (Linux wheel) vs. Windows-native where it won't build.
# Run:  bash setup-wsl.sh
set -euo pipefail

echo "[sa3-wsl] apt deps"
sudo apt-get update -y
sudo apt-get install -y git build-essential ffmpeg curl

echo "[sa3-wsl] uv"
command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"

ROOT="$HOME/stable-audio-3"
echo "[sa3-wsl] clone stable-audio-3"
[ -d "$ROOT" ] || git clone https://github.com/Stability-AI/stable-audio-3.git "$ROOT"
cd "$ROOT"

echo "[sa3-wsl] uv sync (repo deps; pins python 3.10)"
uv sync

# Match the repo's documented Linux recipe exactly: cu126 torch + the cu126/torch2.7/cp310
# flash-attn wheel from the builder the repo itself references.
echo "[sa3-wsl] torch cu126"
uv pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu126

echo "[sa3-wsl] flash-attn (Linux prebuilt wheel - the piece Windows can't do)"
uv pip install https://github.com/mjun0812/flash-attention-prebuild-wheels/releases/download/v0.7.16/flash_attn-2.6.3+cu126torch2.7-cp310-cp310-linux_x86_64.whl

echo "[sa3-wsl] fastapi + uvicorn (our sync server)"
uv pip install fastapi "uvicorn[standard]"

echo "[sa3-wsl] verify"
uv run python -c "import torch, flash_attn; print('torch', torch.__version__, '| cuda', torch.cuda.is_available(), '| flash_attn', flash_attn.__version__)"
echo "SA3_WSL_SETUP_DONE - now: export HF_TOKEN=<token>, put server.py in $ROOT, then: bash run-sa3-server.sh"
