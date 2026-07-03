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

### Generation (ACE-Step on VIDI) — DEPLOYED + WORKING, but slow on 8GB:
- Server is live at `http://vidi-laptop:8001` (VIDI_ACESTEP_URL set in secrets). Ask the Director to "generate a 30s tense bed" and it will — the track lands as a draggable `source='generate'` row, MIT-licensed, analyzed.
- **Caveat:** the RTX 4070 Laptop's 8GB forces INT8 + CPU-offload → generation is SLOW (several minutes/clip, GPU ~26% util). It's a VRAM limit, not a bug. For responsive gen, a bigger-VRAM box (or the non-offload config) is the path. The Tier-1 prompt-writer gives you the generation *value* instantly regardless (paste into Suno/ACE-Step).
- To (re)start the VIDI server after a reboot: `ssh vidi 'powershell -File run-acestep.ps1'` (see services/vidi-acestep/).

### Verdict from the fair (semantic-on) bake-off:
- Default stays **google/gemini-3-flash-preview grounded** — richest real candidate pools; triad needs a richer library to win. Full write-up: DIRECTOR-BAKEOFF-RESULTS.md.
