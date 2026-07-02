# Akasi Sounds — 10x Feature Backlog

Compiled 2026-07-02 from competitor research: Soundly (spectrogram, NL search + thesaurus,
pitch/speed/reverse-before-drag, Segments, playlists), Soundminer v6 (Spotting Panel,
XRay waveforms, varispeed, tabbed/locked search, RadFX), BaseHead (snappy browse, Peek
Tree playlists, pitched/trimmed spotting), SoundQ (collections, iXML metadata editing).

**Loop discipline per iteration:** implement top unchecked item → `npm run test:core`
(smoke now runs via `ELECTRON_RUN_AS_NODE` on Electron's ABI — no more better-sqlite3
rebuild flip-flop; never use bare `node scripts/smoke.js`) → `npx vite build` →
preview-verify if UI-visible → commit + push `main` → check item off with a one-line note.

## P1 — the player gets superpowers

- [x] **1. Inline row waveforms** — ✅ 2026-07-02. ffmpeg s16le@4kHz decode → 160-byte
  envelope, concurrency-gated (3) in main, cached in `peaks` BLOB; RowWave canvas per
  virtualized row w/ module-level cache; teal on selection. Bonus: smoke now runs via
  `ELECTRON_RUN_AS_NODE` (`npm run test:core`) — ABI flip-flop eliminated. 24/24.
- [x] **2. Pitch / speed / reverse / gain audition — baked into drag** — ✅ 2026-07-02.
  Varispeed ±12 st (`playbackRate`+`preservesPitch=false`), gain −24..+12 dB via
  GainNode, reverse via ffmpeg-rendered temp (fx-cache, audition = exactly what bakes);
  drag render chains areverse→crop→asetrate/aresample→volume→fades. Keys: R / [ ] / 0,
  reset-per-file. Gotchas fixed: `-t` must be an INPUT option (output `-t` + varispeed
  silently pulls extra input); functional fx updates (rapid keys clobbered). 27/27.
- [x] **3. Loop + auto-play toggles, richer transport shortcuts** — ✅ 2026-07-02.
  LOOP/AUTO/MUTE pills in dock (L/A/M keys, loop+autoplay persisted), ←/→ seek restored,
  `?` in-app cheat-sheet overlay (3 groups, 14 keys, Esc closes). Bonus UX fix: ↓ from
  the search input blurs + jumps into auditioning (typing guard was trapping all keys
  while search was focused — the type-then-arrow flow now works like Soundly).
- [x] **4. Segments** — ✅ 2026-07-02. `detectSegments()` inverts silencedetect
  (−35dB/0.25s) into take regions; chips row ("N takes", keys 1–9) auto-crops +
  plays a take; selection-aware transport stops at take end (or cycles when LOOP on);
  dashed boundary ticks on the canvas; drag bakes just the take. Session-cached in
  main; hidden when reversed (chip times describe the forward timeline). Smoke 29/29
  (synthetic 3-burst pack → exactly 3 regions; continuous audio → 1).

## P2 — find sounds like a librarian

- [x] **5. Search thesaurus + autocomplete** — ✅ 2026-07-02. 28 curated synonym
  groups (`src/thesaurus-groups.json`, single source; CJS loader for main, thin ESM
  mirror for renderer), OR-within-group/AND-across-terms FTS ("swish" finds
  whoosh-only files); `fts5vocab`-backed autocomplete (Tab completes, freq-ranked);
  recent searches (localStorage, auto-committed); "≈ synonyms" hint line. Gotchas:
  CJS import from renderer blanked dev mount (→ JSON+dual loaders); React onFocus
  doesn't fire for autofocused inputs (→ open panel on type/click too). 32/32.
- [x] **6. Recently Used + use-count surfacing** — ✅ 2026-07-02. "Recent" scope in
  sidebar (last-used order, live count), sort dropdown (relevance/newest/duration/
  most-used) wired through db.search ORDER BY map, amber ×N badges on used rows.
  36/36 smoke; verified in preview (most-used sort surfaces ×5 first).
- [x] **7. Inline metadata editing** — ✅ 2026-07-02. ✎ on row hover opens an anchored
  editor (name/tags/kind toggle + artist/genre/BPM when music); Enter saves, Esc
  cancels; whitelisted `updateMeta` keeps license/attribution provider-authoritative;
  FTS syncs via existing triggers; kind flips move scope counts live. 40/40.

## P3 — depth & polish

- [x] **8. Spectrogram toggle in the dock** — ✅ 2026-07-02. Pure-JS STFT
  (`renderer/lib/spectrogram.mjs`: radix-2 FFT, Hann, 96 log-spaced bins, dB-normalized)
  over the already-decoded buffer; brand heatmap (dark→teal→amber) composited under
  selection/playhead/segment overlays; SPEC pill + `S` key, persisted. DSP verified in
  smoke: 200Hz→bin 6, 3kHz→bin 96 (theory 6.4/96). 41/41. Gotcha: `.js` ESM can't be
  dynamic-imported under `"type":"commonjs"` → renamed `.mjs`.
- [x] **9. Multi-select batch ops** — ✅ 2026-07-02. ⌘-click toggle / ⇧-click range /
  ⌘A all / Esc clear (amber checked styling, separate from the teal audition cursor);
  floating batch bar: Favorite-all, add-all-to-collection, multi-file native drag
  (original/cached files via `startDrag({files})` — no crop/FX on batch), transactional
  DB batch methods. 44/44; range→favorite flow verified in preview.
- [x] **10. Waveform hover-scrub on rows** — ✅ 2026-07-02. ⌥-hover a row's mini
  waveform scrub-previews from that exact point via one shared scrub `<audio>`
  (90ms-throttled seeks, URL cache); amber scrub line on the row canvas; dock
  pauses itself on `akasi:scrub-start`. Alt-gated so casual mousing stays silent.
  Verified pixel-level in preview (line draws at 60% hover, clears on leave).
- [ ] **11. Credits/attribution export** — per-collection Markdown/CSV manifest;
  flag CC-BY-NC as non-client-safe (plan U12).
- [ ] **12. Tabbed / locked searches** — search tabs scoped to a collection or scope
  (Soundminer v6 locked tabs).

## Deferred (separate phases, already planned)
- ACE-Step generation on VIDI (plan U9/U10) · CLAP semantic search + auto-tag (U11) ·
  Freesound OAuth full-quality originals · signing/notarization.
