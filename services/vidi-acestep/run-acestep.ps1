# Launch the ACE-Step 1.5 REST API server on VIDI, bound to all interfaces so it's
# reachable over the tailnet (vidi-laptop:8001). Run on VIDI:
#   powershell -ExecutionPolicy Bypass -File run-acestep.ps1
# Weights auto-download from HuggingFace on the first generation call.
$ErrorActionPreference = "Stop"
$root = Join-Path $HOME "ACE-Step-1.5"
$uvbin = Join-Path $HOME ".local\bin"
if (Test-Path $uvbin) { $env:Path = "$uvbin;$env:Path" }
Set-Location $root

# Bind to 0.0.0.0 so M5 can reach it over tailscale. If this build of acestep-api
# doesn't accept --host/--port, it defaults to localhost:8001 - then use an SSH
# tunnel from M5 instead:  ssh -N -L 8001:localhost:8001 vidi
$env:ACESTEP_HOST = "0.0.0.0"
$env:ACESTEP_PORT = "8001"
# Eager-load models at startup so the task worker spins up before requests arrive
# (lazy init left the queue worker not draining jobs).
$env:ACESTEP_NO_INIT = "false"
Write-Output "[acestep-run] starting acestep-api on 0.0.0.0:8001 (eager init)"
uv run acestep-api --host 0.0.0.0 --port 8001
