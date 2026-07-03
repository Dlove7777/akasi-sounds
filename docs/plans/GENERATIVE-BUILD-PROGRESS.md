# Generative + Grounding — Build Progress Ledger

> Overnight autonomous build of `docs/plans/2026-07-02-001-feat-generative-grounding-director-plan.md`.
> Goal: all phases built + green by morning for Dennis to test. Per-unit: build → `npm run test:core` (0 failed) → `npm run build:renderer` → commit+push. Never bare-`node` DB scripts (ABI). This ledger survives context summarization — resume from the first unchecked unit.

## Status
- [ ] U1 Scoring Playbook module (src/playbook.js) + director SYSTEM
- [ ] U2 Tier-1 generation prompt-writer (src/genprompt.js + write_generation_prompt tool)
- [ ] U3 Reference-exemplar matching (match_reference tool)
- [ ] U4 Fix CLAP deadlock under ELECTRON_RUN_AS_NODE (semantic-eval path)
- [ ] U5 Semantic-on bake-off → verdict (needs U4; real OpenRouter --quick, keep spend small)
- [ ] U6 ACE-Step on VIDI (GPU-gated — attempt live deploy; else document + build client with mocks)
- [ ] U7 Generate provider + generate:run IPC (buildable with mock client + smoke)
- [ ] U8 Director generate_music tool + panel progress (buildable with mock + smoke)
- [ ] U9 RAG scoring/theory KB (src/rag.js + docs/scoring/) — buildable now (local CLAP embeds)
- [ ] U10 Project-memory house-style corpus (cue_history) — buildable now

## Notes
- VIDI (ssh alias `vidi`, user dlove): Windows/PowerShell over SSH (NO bash, no `||`), **RTX 4070 Laptop 8GB VRAM** (7.9GB free), Python 3.12.7, git 2.54, **NO docker**. → native `uv` install, **2B-turbo** variant only (XL needs 24GB). Deploy via scp'd .ps1 (no heredoc over SSH). ACE-Step: `git clone ACE-Step-1.5` + `uv sync`; launch `uv run acestep-api` (:8001, HF auto-download ~4.7GB); 8GB `.env`: ACESTEP_CONFIG_PATH=acestep-v15-turbo, ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-0.6B.
- [x] U1 done (bdd0619, test:core 88/88).
- Baseline: test:core 86/86, main @ 4435e77 + subsequent (Jamendo/Freesound director), plan committed.
- U6 live end-to-end generation may be the ONE thing gated on hardware; U7/U8 land green with mock client either way.

## Morning test report
(filled in at the end)
