# ACE-Step 1.5 setup for VIDI (Windows, RTX 4070 Laptop 8GB, Python 3.12, no Docker).
# Run on VIDI:  powershell -ExecutionPolicy Bypass -File setup-acestep.ps1
# Idempotent: safe to re-run. Logs progress; installs uv, clones the repo, writes the
# 8GB turbo .env, and runs `uv sync`. Model weights auto-download on first generation.
$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "ACE-Step-1.5"

Write-Output "[acestep-setup] ensuring uv is installed"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
}
# uv installs to ~\.local\bin on Windows; add to this session's PATH
$uvbin = Join-Path $HOME ".local\bin"
if (Test-Path $uvbin) { $env:Path = "$uvbin;$env:Path" }

Write-Output "[acestep-setup] cloning ACE-Step-1.5 (if absent)"
if (-not (Test-Path $root)) {
  git clone https://github.com/ACE-Step/ACE-Step-1.5.git $root
}
Set-Location $root

Write-Output "[acestep-setup] writing 8GB turbo .env"
"ACESTEP_CONFIG_PATH=acestep-v15-turbo`r`nACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B" | Out-File -Encoding ascii -FilePath (Join-Path $root ".env")

Write-Output "[acestep-setup] uv sync (this pulls torch+CUDA and deps - can take a while)"
uv sync

Write-Output "ACESTEP_SETUP_DONE"
