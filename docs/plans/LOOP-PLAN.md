# Akasi Sounds — Build Loop Plan (2026-07-02)

> **Durable ledger for a self-paced `/loop`.** Each firing: read this file, do the
> **next unchecked iteration end-to-end**, then check it off and append a one-line
> result note. One iteration = one feature = one commit+push. Stop at the STOP gate.

## Per-iteration discipline (do ALL, in order)
1. Build the feature (edit the files listed).
2. `npm run test:core` → must end `N passed, 0 failed`. Add/extend a smoke assert for the new backend logic.
3. `npm run build:renderer` → must succeed (catches JSX/import breakage; GUI verify is Dennis's, note it).
4. `git add -A && git commit` (conventional message) `&& git push`.
5. Check the box below, append `— <result>`; update "Last iteration" footer.

**Never** run `node scripts/smoke.js` bare (flips better-sqlite3 ABI). If ABI errors: `npm run rebuild`.
No GNU `timeout` on macOS → `perl -e 'alarm N; exec @ARGV'`.

## Architecture facts (don't re-derive)
- `src/search.js` `blendedSearch(db, sidecar, query, opts, clapReady)` — shared by app + MCP. `stripEmb(row)` drops the blob.
- `src/db.js`: `allEmbeddings()` → `[{id, embedding(Buffer)}]`; `updateMeta(id,{name,tags,kind,artist,album,genre,bpm,year})` whitelisted, FTS auto-syncs; `getSound(id)`.
- `src/sidecar.js`: `cosine(bufA /*Buffer blob*/, arrB /*number[]*/)`, `embedText(s)`, `embedAudio(path)` → `{embedding:[512]}`; `available()`.
- Embeddings are stored as Float32 BLOBs. In-library similarity needs **no CLAP warm-up** (blobs already on disk) — cosine in JS.
- IPC lives in `electron/main.js`; bridge in `electron/preload.js` (`window.akasi.*`); UI in `renderer/App.jsx` + `renderer/components/SoundRow.jsx`; styles `renderer/styles.css`.
- OpenRouter: base `https://openrouter.ai/api/v1`, key `OPENROUTER_API_KEY` (loaded from `~/.secrets.env` by main.js + smoke). OpenAI-compatible `/chat/completions` w/ `tools`.
- Existing CLI director (`agents/music-director/director.js`) is the tool-loop reference (OpenAI-style tool calls, 12-step budget, forced synthesis near budget). The in-app director reuses `blendedSearch` **in-process** (no MCP round-trip).

---

## Iterations

### [x] 1. Find Similar (in-library) — instant, no LLM — DONE
- `src/search.js`: add `similarByEmbedding(db, sidecar, targetArr, {limit=30, excludeId})` — loop `db.allEmbeddings()`, `sidecar.cosine(row.embedding, targetArr)`, sort desc, take top, hydrate via `db.getSoundsByIds`, return `stripEmb` rows tagged `_sim:score` (skip excludeId). Export it.
- `src/db.js`: add `getSoundsByIds(ids)` → `Map(id→row)` (single `WHERE id IN (...)`); add `getEmbeddingArray(id)` → `Array.from(Float32Array(blob))` or null.
- `electron/main.js`: `ipcMain.handle('similar:byId', (_e,{id,limit}) => { const t=db.getEmbeddingArray(id); if(!t) return {error:'not analyzed', results:[]}; return {results: similarByEmbedding(db,sidecar,t,{limit:limit||40,excludeId:id})}; })`. Import `similarByEmbedding`.
- `electron/preload.js`: `findSimilar: (id,limit)=>ipcRenderer.invoke('similar:byId',{id,limit})`.
- `renderer/components/SoundRow.jsx`: add a `≋` action button (title "Find similar") → `onFindSimilar(s)`; thread the prop from ResultsList.
- `renderer/App.jsx`: `similarOf` state; `onFindSimilar` runs `findSimilar`, `setResults`, sets a banner row above results ("≋ Similar to {name} · ✕ clear"); any scope/query change clears it.
- Test: smoke — insert 3 rows w/ crafted embeddings, assert `similarByEmbedding` ranks the nearest first and excludes self.

### [x] 2. Upload sample → find similar — DONE
- `electron/main.js`: `similar:pickFile` (dialog `openFile`, audio exts) + `similar:byFile` (`if(!sidecar.available()) return {error}`; `const r=await sidecar.embedAudio(path)`; `return {results: similarByEmbedding(db,sidecar,r.embedding,{limit:40})}`).
- `preload.js`: `pickSampleFile`, `similarByFile(path)`.
- `App.jsx`: searchbar button `⇪ Match sample` → pick → results + banner "≋ Similar to <basename>". Also accept an external-audio drop on the results area (nice-to-have).
- Test: smoke — assert an identical-embedding target ranks its twin #1 (pure cosine path; CLAP not required).

### [x] 3. Manual reclassify + custom-tag chips — DONE
- `renderer/components/SoundRow.jsx` `MetaEditor`: render `tags` as removable chips (`× ` each) + an add-input (Enter/comma commits, additive, dedupe). Keep kind toggle (reclassify), genre/bpm. Join chips → space-string on save (updateMeta already handles it). Show tags editing for BOTH sfx and music.
- `renderer/styles.css`: `.tag-chip` styling.
- Test: smoke — `updateMeta` additive tag round-trip (add a tag, assert FTS finds it; remove, assert it doesn't). (updateMeta already partly covered — extend.)

### [x] 4. Research latest OpenRouter models — DONE (bg Sonnet subagent)
Shortlist: `google/gemini-3-flash-preview` (default), `z-ai/glm-5.2` (verified last-2-wk), `deepseek/deepseek-v4-flash` (cost floor), `google/gemini-3.1-flash-lite`, `anthropic/claude-haiku-4.5` (reliability baseline). No Gemini Flash newer than 3.5-flash (2026-05-19) found; no GLM cheaper than 5.2. Full doc: docs/plans/OPENROUTER-MODEL-CANDIDATES.md.
- Spawn a background research subagent (Sonnet): scan OpenRouter's model list + release notes for models launched in the **last ~2 weeks** — new **Gemini Flash**, new **Zai/GLM**, plus any others strong at cheap tool-calling. For each: exact OpenRouter model id, context, $/Mtok in+out, tool-calling support, notes.
- Write `docs/plans/OPENROUTER-MODEL-CANDIDATES.md` (table + a shortlist of ~5 to bake off). Commit (doc-only).

### [x] 5. In-app Music Director chat — grounded-director (ships) — DONE
- `src/director.js` (NEW, in-process): `async function runDirector({db, sidecar, clapReady, messages, model, mode:'grounded', onEvent})`.
  - Tools → LLM: `search_sounds({query,kind,bpmMin,bpmMax,durMin,durMax,instrumental,genre,limit})`, `get_sound({id})`, `library_stats()`. Dispatch `search_sounds` via `blendedSearch(db,sidecar,query,opts,clapReady)`.
  - Accumulate every surfaced row into a `pool` (Map id→row). Emit `onEvent({type:'tool',...})` and `onEvent({type:'pool', rows})` so the panel shows live candidates. Final assistant message = cue sheet; emit `onEvent({type:'final', text, pickIds})`.
  - Structurally can't hallucinate paths: rows come only from tool results.
  - System prompt: adapt `agents/music-director/PROMPT.md` (search-broad-first, pick 3-6, cite real paths). 12-step budget + forced-synthesis near budget (mirror CLI).
- `electron/main.js`: `director:chat` handler streaming events to renderer (`director:event`), reading `OPENROUTER_API_KEY`; default model from candidates doc.
- `preload.js`: `directorChat(messages,opts)`, `onDirectorEvent(cb)`.
- `renderer/components/DirectorPanel.jsx` (NEW): right slide-out — chat log, input, and **live rows** (reuse SoundRow / a compact row) that audition + native-drag (`window.akasi.startDrag`). Toggle from a header button in App.jsx.
- Test: smoke — `runDirector` with a **mock LLM** (inject a fake `chat` that emits one `search_sounds` call then a final) proves the tool dispatch returns real rows + no fabricated ids.

### [x] 6. Bake-off harness (A/B) — DONE  — NOTE: `mode:'triad'` ALREADY BUILT + tested in iter 5's src/director.js
- ~~`src/director.js`: add `mode:'triad'`~~ DONE in iter 5 (keyword-librarian + mood-supervisor retrievers → judge). This iteration = just the harness + smoke.
- `scripts/director-bakeoff.js` (runs under ELECTRON_RUN_AS_NODE vs real app DB, read-only): for each (brief × model × mode) record steps, `usage` tokens→cost, latency, and **honesty** = every path/id in the final answer exists in DB. ~6 briefs. Emit `docs/plans/DIRECTOR-BAKEOFF-RESULTS.md` ranked on honesty > tool-discipline > cost (NOT reasoning depth).
- Test: smoke — triad mode with mock retriever+judge returns picks strictly ⊆ real pool.

### [x] 7. Run bake-off → pick default + wire → STOP — DONE (loop complete)
- Run `scripts/director-bakeoff.js` across the candidate models (real OpenRouter calls; keep total spend small — few briefs). Write ranked results + a one-line recommendation into `DIRECTOR-BAKEOFF-RESULTS.md`.
- Wire the chosen default `{model, mode}` into `src/director.js` / main.js.
- **STOP the loop.** Do NOT build: generative Music Director (ACE-Step on VIDI), RAG knowledge-grounding, or a deeper agent swarm. Final message: summarize what shipped and recommend Dennis run **`/ce-plan`** with fresh context for that heavy phase (per handoff planning guidance).

---
**Last iteration:** #7 Bake-off RUN — test:core 82/82, renderer build clean. **LOOP COMPLETE.** Ran real OpenRouter matrix (5 models × 2 modes × 2 briefs). Fixed 2 real bugs found: (a) `sidecar.startClap()` deadlocks under ELECTRON_RUN_AS_NODE → harness runs keyword-only; (b) em-dash in `X-Title` header broke every fetch (latin1) + added AbortController fetch timeout. Result: **default `google/gemini-3-flash-preview` grounded** (100% honest, richest pools, usable cue sheets, ~$0.006/run). deepseek disqualified (fabrication); triad unevaluated (needs semantic search on). Fixed the ranker to rank productive (cand>0) configs first. **STOP gate reached — generative/ACE-Step + RAG-grounding + deeper agent-swarm = /ce-plan with fresh context.**
