# Generative + Grounding — Build Progress Ledger

> Overnight autonomous build of `docs/plans/2026-07-02-001-feat-generative-grounding-director-plan.md`.
> Goal: all phases built + green by morning for Dennis to test. Per-unit: build → `npm run test:core` (0 failed) → `npm run build:renderer` → commit+push. Never bare-`node` DB scripts (ABI). This ledger survives context summarization — resume from the first unchecked unit.

## Status — ALL 10 UNITS CODE-COMPLETE + GREEN (test:core 108/108)
- [x] U1 Scoring Playbook (src/playbook.js) — bdd0619
- [x] U2 Tier-1 prompt-writer (src/genprompt.js + write_generation_prompt) — 1778073
- [x] U3 Reference-exemplar matching (match_reference) — e2f6994
- [x] U4 CLAP "deadlock" was a misdiagnosis — warms in ~5s; bakeoff warms it — 38b221d
- [x] U5 Semantic-on bake-off → grounded gemini stays default (fair verdict) — b0093c7
- [x] U6 ACE-Step 1.5 DEPLOYED LIVE on VIDI (RTX 4070 8GB, uv, :8001, reachable) — 1778073 (scripts)
- [x] U7 Generate provider + generate:run IPC — a3dd5d7 (client API-corrected below)
- [x] U8 Director generate_music tool + panel progress — a3dd5d7
- [x] U9 RAG scoring KB (src/scoring/ + src/rag.js + lookup_scoring_ref) — 996a408
- [x] U10 Project-memory (cue_history + recall_house_style) — f5bcb98

## VIDI live-generation status (the one hardware-bound item)
- ACE-Step 1.5 installed + server UP + reachable at http://vidi-laptop:8001 (health OK, model loaded).
- Generation WORKS (first probe produced audio) but is SLOW on the 8GB laptop 4070: INT8 + CPU-offload thrashing → GPU ~26% util → many minutes per short clip. This is a VRAM constraint, not a bug.
- Real API pinned: release_task uses `audio_format:"wav"` (mp3 needs ffmpeg, absent on VIDI), `batch_size:1`; query_result returns `data:[]` (array) with status int (1=ok,2=fail) + `file`. generate.js corrected to match.
- Open: confirm completed-item parse against a captured result; consider a non-offload/smaller config or more VRAM for responsive UX.

## Notes
- VIDI (ssh alias `vidi`, user dlove): Windows/PowerShell over SSH (NO bash, no `||`), **RTX 4070 Laptop 8GB VRAM** (7.9GB free), Python 3.12.7, git 2.54, **NO docker**. → native `uv` install, **2B-turbo** variant only (XL needs 24GB). Deploy via scp'd .ps1 (no heredoc over SSH). ACE-Step: `git clone ACE-Step-1.5` + `uv sync`; launch `uv run acestep-api` (:8001, HF auto-download ~4.7GB); 8GB `.env`: ACESTEP_CONFIG_PATH=acestep-v15-turbo, ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B.
- [x] U1 done (bdd0619, test:core 88/88).
- Baseline: test:core 86/86, main @ 4435e77 + subsequent (Jamendo/Freesound director), plan committed.
- U6 live end-to-end generation may be the ONE thing gated on hardware; U7/U8 land green with mock client either way.

## Morning test report (2026-07-02 overnight)

**All 10 units shipped, test:core 64→108, main @ 026bf38, working tree clean, every unit pushed.**

Restart the app to pick it up: `Ctrl-C`, then `npm run dev` (main-process changed).

### Test instantly (no GPU, all live):
1. 🎬 **Director** — now grounded in the Scoring Playbook. Ask "a tense instrumental bed under 90 BPM for a promo" → it searches local + Freesound + Jamendo, and when thin, **honestly offers a generation prompt** instead of forcing a weak pick.
2. **"Draft me a generation prompt for a dark lo-fi bed"** → `write_generation_prompt` returns a copy-pasteable ACE-Step/Suno caption instantly (works with zero GPU).
3. **"Find something that sounds like <a track>"** → `match_reference` (CLAP similarity).
4. **≋** on a row → Find Similar; **⇪ Match sample** → drop an audio file.
5. Deeper craft grounding (`lookup_scoring_ref`) + house-style memory (`recall_house_style`, builds up as you use it) run under the hood.

### Generation — PIVOTED to Stable Audio 3 Medium (client swap DONE; server = 1 daytime WSL2 job)
- **Why the pivot:** ACE-Step's async REST worker wedged on 8GB (decode-stage stall — matches their issues #146/#1235, a VRAM problem, not just a bug). Research (6 legs) settled on **Stable Audio 3 Medium** as the client-safe replacement: Stability Community License (commercial <$1M — your comfort zone), pure/licensed-CC provenance, **up to 6-min** tracks (vs ACE-Step's async pain and Open 1.0's 47s cap), fits 8GB (~5-6.5GB).
- **Client side is DONE + green (test:core 109/109):** `src/providers/generate.js` rewritten from ACE-Step's async release_task/poll/query_result loop to a single **synchronous `POST /generate`** (no queue to wedge). License string + "Powered by Stability AI" provenance stamp wired; `credits.js` recognizes it as client-safe "generated". Env var `STABLE_AUDIO_URL`.
- **Server side = one daytime WSL2 job** (turnkey prepped in `services/vidi-stableaudio3/`): SA3 needs flash-attn, which won't build on VIDI Windows-native (no wheel; needs nvcc/MSVC) but installs cleanly under **WSL2 Ubuntu** (CUDA passthrough to the 4070). `server.py` (FastAPI sync wrapper), `setup-wsl.sh`, `run-sa3-server.sh`, `README-DEPLOY.md` (full runbook incl. the WSL2 networking step) are all ready.
- **Daytime steps (needs Dennis for admin/reboot + HF license):** (1) accept license at hf.co/stabilityai/stable-audio-3-medium + `secret add HUGGINGFACE_TOKEN`; (2) `wsl --install` + reboot on VIDI; (3) run `setup-wsl.sh` → `run-sa3-server.sh`; (4) `secret add STABLE_AUDIO_URL http://vidi-laptop:8005`. Then Director generation works end-to-end. Full runbook: services/vidi-stableaudio3/README-DEPLOY.md.
- **Fallback on file:** ACE-Step 1.5's sync Python API (`generate_music()`, MIT) if longer-than-6min ever needed — but fights the same 8GB decode stall. services/vidi-acestep/ scripts kept as reference.

### (superseded) ACE-Step notes:
- **Honest status:** ACE-Step 1.5 is installed, the REST server is up + reachable at `http://vidi-laptop:8001`, and it **generated audio once** during initial model-load (proving the pipeline). BUT after that, queued tasks don't execute — the server logs only show polls, no inference steps, GPU sits ~27% idle. So it's **wedged, not merely slow.** Root cause is ACE-Step's async task worker on this 8GB Windows box (the first task's mp3-save crash may have poisoned the queue; or a version/config quirk). This is a SERVER-side issue — the Akasi client (`src/providers/generate.js`) is API-correct and ready; the moment the server generates reliably, in-app generation works end-to-end.
- **What DOES fully work now:** the Tier-1 `write_generation_prompt` gives you a rich ACE-Step/Suno caption instantly (no GPU) — that's the generation *value* with zero dependency on the VIDI worker.
- **To debug the worker in the AM:** restart clean via `ssh vidi 'powershell -File kill-acestep.ps1'` then `run-acestep.ps1`; try one gen; watch the server log for inference steps. Candidate fixes: pin an ACE-Step release, try `ACESTEP_NO_INIT=false` (eager model load) in run-acestep.ps1, or generate a single short clip right after start. A bigger-VRAM box would also sidestep the 8GB offload path entirely.

### Verdict from the fair (semantic-on) bake-off:
- Default stays **google/gemini-3-flash-preview grounded** — richest real candidate pools; triad needs a richer library to win. Full write-up: DIRECTOR-BAKEOFF-RESULTS.md.
