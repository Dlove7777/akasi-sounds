# Akasi Sounds — 10x Feature Backlog

Compiled 2026-07-02 from competitor research: Soundly (spectrogram, NL search + thesaurus,
pitch/speed/reverse-before-drag, Segments, playlists), Soundminer v6 (Spotting Panel,
XRay waveforms, varispeed, tabbed/locked search, RadFX), BaseHead (snappy browse, Peek
Tree playlists, pitched/trimmed spotting), SoundQ (collections, iXML metadata editing).

**Loop discipline per iteration:** implement top unchecked item → `node scripts/smoke.js`
→ **`npm run rebuild`** (smoke rebuilds better-sqlite3 to node ABI and breaks Electron —
always rebuild after) → `npx vite build` → preview-verify if UI-visible → commit + push
`main` → check item off with a one-line note.

## P1 — the player gets superpowers

- [ ] **1. Inline row waveforms** — mini waveform strip in every result row (BaseHead/
  Soundly signature scannability). Compute peaks lazily in main via ffmpeg (`-af
  astats`/PCM decode), cache as a small BLOB column (`peaks`) so rows render instantly
  on revisit; render on a tiny canvas per visible (virtualized) row only.
- [ ] **2. Pitch / speed / reverse / gain audition — baked into drag** — Soundly's
  killer trick. Live preview: `playbackRate` + `preservesPitch=false` for varispeed,
  gain via WebAudio GainNode. Drag-out render bakes the same transform via ffmpeg
  (`asetrate`/`atempo`/`areverse`/`volume`). Reset-on-new-file like Soundminer's
  varispeed fader.
- [ ] **3. Loop + auto-play toggles, richer transport shortcuts** — `L` loop, `A`
  auto-play-on-select toggle, `R` reverse, `M` mute, `[`/`]` pitch nudge, `?` opens a
  shortcut cheat-sheet overlay (Soundly ships a printed cheat sheet; ours is built in).
- [ ] **4. Segments** — auto-split multi-variation files (ffmpeg `silencedetect`),
  show segment pips on the dock waveform, click to audition a segment, drag just that
  segment to the timeline. (Soundly "Segments".)

## P2 — find sounds like a librarian

- [ ] **5. Search thesaurus + autocomplete** — built-in SFX synonym map (whoosh ≈
  swish/swoosh/pass-by; hit ≈ impact/thud/slam …), OR-expanded FTS query; autocomplete
  dropdown fed by indexed tags + recent searches (persisted).
- [ ] **6. Recently Used + use-count surfacing** — "Recent" scope (we already track
  `use_count`/`last_used_at`), sort options (relevance / newest / duration / most-used),
  subtle use-count dot on rows. (Soundminer Spotting-panel energy, minus the modal UI.)
- [ ] **7. Inline metadata editing** — rename, edit tags, set kind (sfx/music) from a
  row context menu / inspector; writes back to the index (not the file) so licensing
  fields stay authoritative. (SoundQ metadata editing, index-side.)

## P3 — depth & polish

- [ ] **8. Spectrogram toggle in the dock** — Web Audio FFT → canvas heatmap behind the
  waveform (Soundly Spectrogram View); toggle with `S`.
- [ ] **9. Multi-select batch ops** — shift/cmd-click rows → favorite, add-to-collection,
  drag several as one multi-file native drag.
- [ ] **10. Waveform hover-scrub on rows** — hover a row's mini waveform to preview from
  that point without changing dock selection (BaseHead snappiness).
- [ ] **11. Credits/attribution export** — per-collection Markdown/CSV manifest;
  flag CC-BY-NC as non-client-safe (plan U12).
- [ ] **12. Tabbed / locked searches** — search tabs scoped to a collection or scope
  (Soundminer v6 locked tabs).

## Deferred (separate phases, already planned)
- ACE-Step generation on VIDI (plan U9/U10) · CLAP semantic search + auto-tag (U11) ·
  Freesound OAuth full-quality originals · signing/notarization.
