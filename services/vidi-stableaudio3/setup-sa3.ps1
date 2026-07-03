# Stable Audio 3 Medium setup for VIDI (Windows, RTX 4070 8GB, Python 3.12, cu128).
# Clones the repo, installs deps + torch cu128 + flash-attn (the Windows risk).
# Model weights download separately (gated - needs HF token) on first generate.
$ErrorActionPreference = "Continue"
$root = Join-Path $HOME "stable-audio-3"
$uvbin = Join-Path $HOME ".local\bin"
if (Test-Path $uvbin) { $env:Path = "$uvbin;$env:Path" }

Write-Output "[sa3-setup] cloning stable-audio-3"
if (-not (Test-Path $root)) { git clone https://github.com/Stability-AI/stable-audio-3.git $root }
Set-Location $root

Write-Output "[sa3-setup] uv venv + sync"
uv venv --python 3.12
uv sync 2>&1 | Out-String | Write-Output

Write-Output "[sa3-setup] torch cu128"
uv pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128 2>&1 | Out-String | Write-Output

Write-Output "[sa3-setup] flash-attn (the Windows make-or-break)"
uv pip install flash-attn 2>&1 | Out-String | Write-Output

Write-Output "[sa3-setup] verify imports"
uv run python -c "import torch, flash_attn; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), 'flash_attn', flash_attn.__version__)" 2>&1 | Out-String | Write-Output
Write-Output "SA3_SETUP_DONE"
