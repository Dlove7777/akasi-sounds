# Stable Audio 3 on VIDI (WSL2) — daytime deploy runbook

Why WSL2: Stable Audio 3 Medium requires flash-attn, which won't build on VIDI's
Windows-native stack (no prebuilt Windows wheel; source build needs nvcc + MSVC). Under
WSL2 Ubuntu the official Linux flash-attn wheel installs in seconds and the whole ML
stack "just works" — same box, same RTX 4070 via CUDA passthrough. This also sidesteps
the ffmpeg/Docker/PowerShell-quoting pain that Windows-native hit.

**Client side is already done** (`src/providers/generate.js` calls a synchronous
`POST /generate`). This runbook only stands up the server. Est. ~20 min.

## Prereqs (one-time, needs admin + a reboot — Dennis)
1. **Accept the license** at https://huggingface.co/stabilityai/stable-audio-3-medium
   (your HF account) and create a Read token at https://huggingface.co/settings/tokens.
2. On VIDI (PowerShell as admin): `wsl --install` → reboot → set up an Ubuntu user.
   (Win11 22H2+ ships WSL2 with CUDA passthrough for the 4070; no extra GPU driver in WSL.)

## Deploy
From M5:
```
# 1. copy the server + scripts into WSL2 home (via the Windows drive or scp to the WSL sshd)
#    simplest: from VIDI Windows, copy this folder into \\wsl$\Ubuntu\home\<user>\
# 2. inside WSL2 Ubuntu:
bash setup-wsl.sh                      # installs SA3 + torch cu126 + flash-attn + fastapi
export HF_TOKEN=<your-hf-token>        # for the gated weights (first /generate downloads ~model)
cp server.py ~/stable-audio-3/
bash run-sa3-server.sh                 # serves 0.0.0.0:8005
```

## Make it reachable from M5 (the one WSL2 networking step)
WSL2 has its own network namespace, so `vidi-laptop:8005` won't hit it by default. Pick one:
- **Mirrored networking (simplest, Win11 23H2+):** create `C:\Users\dlove\.wslconfig` with:
  ```
  [wsl2]
  networkingMode=mirrored
  ```
  then `wsl --shutdown` and restart. WSL services are now reachable on the host IP directly.
- **Or port-proxy (older Windows):** from an admin PowerShell on VIDI:
  ```
  $wsl = (wsl hostname -I).Trim().Split(" ")[0]
  netsh interface portproxy add v4tov4 listenport=8005 listenaddress=0.0.0.0 connectport=8005 connectaddress=$wsl
  New-NetFirewallRule -DisplayName "SA3 8005" -Direction Inbound -LocalPort 8005 -Protocol TCP -Action Allow
  ```

## Point the app at it
```
secret add STABLE_AUDIO_URL        # value: http://vidi-laptop:8005
```
Restart the app (`npm run dev`). Verify: `curl http://vidi-laptop:8005/health` → `{status:'ok', cuda:true}`.
Then ask the Director to "generate a 2-minute tense underscore" — it lands as a draggable
`source='generate'` row, licensed `Stable Audio 3 / Stability Community License` with a
"Powered by Stability AI" credit.

## Verify the API signature (5-min check at deploy)
`server.py` calls `StableAudioModel.from_pretrained("medium").generate(prompt=, duration=)`
per the repo README. If the real signature differs (e.g. `seconds_total` instead of
`duration`, or a pipeline object), adjust the `kwargs` in `server.py:generate()` — the
wrapper already falls back to the minimal `(prompt, duration)` form on a TypeError.
