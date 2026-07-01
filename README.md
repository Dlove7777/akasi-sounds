# Akasi Sounds

A local-first **sound-effects library manager** for video editors — a Soundly-style
tool built for Akasi edit projects. Search your own SFX folders *and* Freesound's
600k+ Creative-Commons library, audition with a waveform, crop/fade, and **drag the
result straight into Premiere / Resolve / FCP**.

## Why
Soundly nails the workflow (search → audition → drag to timeline) but locks the
library behind a subscription. Akasi Sounds owns the whole loop over *your* files plus
open CC sources, and the "describe-the-sound" semantic search that makes Soundly
special is powered by an open model (CLAP) — landing in V2.

## Stack
- **Electron** shell (native OS drag-out is the whole point — a browser can't do it)
- **React + Vite** renderer
- **better-sqlite3** local index with **FTS5** keyword search (semantic column reserved for V2)
- **ffmpeg** for probe + crop/fade render on drag
- Pluggable **providers** (`src/providers/`) — Freesound today; Pixabay/Internet Archive/datasets drop in later

## Setup
```bash
npm install                 # installs deps; postinstall rebuilds better-sqlite3 for Electron
cp .env.example .env        # or rely on ~/.secrets.env (auto-loaded in dev)
npm run dev                 # Vite + Electron with devtools
```
If `better-sqlite3` fails to load in Electron, run `npm run rebuild`.

Get a free Freesound key: https://freesound.org/apiv2/apply/ → `secret add FREESOUND_API_KEY`

## Verify the backend without the GUI
```bash
node scripts/smoke.js       # DB+FTS, folder→tags, live Freesound pull, cache, ffmpeg render
```

## How the drag-to-timeline works
On drag-out, the main process renders the (optionally cropped/faded) selection to a
temp 24-bit WAV via ffmpeg, then hands the OS that file via `webContents.startDrag`.
Every NLE accepts a native file drop, so the sound lands on your timeline as a real clip.

## Roadmap
- **V1 (done):** local folder indexing, hybrid-ready keyword search, waveform audition,
  crop/fade, Freesound search+cache, native drag-out.
- **V2:** CLAP semantic search ("tense riser", "wet gravel footsteps") + auto-tagging
  via a Python sidecar (own venv — torch has no Python 3.14 wheels yet).
- **V3:** more providers (Pixabay scrape, Internet Archive, FSD50K dataset import),
  Freesound OAuth for full-quality originals.
- **V4 (if shipping):** onboarding, in-app key management, code-signed packaging.

See [DESIGN.md](DESIGN.md) for the visual system.
