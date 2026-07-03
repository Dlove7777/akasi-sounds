'use strict';
/**
 * Headless backend smoke test — no Electron/GUI required.
 * Verifies: SQLite+FTS search, path->tags, live Freesound search, preview cache
 * download, and ffmpeg crop/render. Run: `node scripts/smoke.js`
 * (Loads keys from ~/.secrets.env if present.)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Load ~/.secrets.env (KEY=VALUE lines) into process.env if not already set.
try {
  const envFile = path.join(os.homedir(), '.secrets.env');
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no secrets file — env-provided keys still work */ }

const { openDb } = require('../src/db');
const { tagsFromPath } = require('../src/indexer');
const freesound = require('../src/providers/freesound');
const { ensureCached } = require('../src/cache');
const audio = require('../src/audio');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? '  — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'akasi-sounds-smoke-'));

  // 1. DB + FTS search
  const db = openDb(path.join(tmp, 'index.db'));
  db.upsertMany([
    { source: 'local', source_id: '/a/thunder_clap.wav', name: 'thunder_clap.wav', tags: 'thunder storm weather', duration: 3.2 },
    { source: 'local', source_id: '/a/rain_light.wav', name: 'rain_light.wav', tags: 'rain weather ambience', duration: 12 },
    { source: 'local', source_id: '/a/door_slam.wav', name: 'door_slam.wav', tags: 'door slam impact', duration: 1.1 },
  ]);
  const thunder = db.search('thunder');
  ok('FTS keyword search "thunder"', thunder.length === 1 && thunder[0].name.includes('thunder'), `${thunder.length} hit(s)`);
  const prefix = db.search('weath');
  ok('FTS prefix search "weath"', prefix.length === 2, `${prefix.length} hits`);
  const browse = db.search('');
  ok('Empty query browses library', browse.length === 3, `${browse.length} rows`);
  const id = thunder[0].id;
  db.toggleFavorite(id);
  ok('Toggle favorite', db.getSound(id).favorite === 1);
  db.markUsed(id);
  ok('Mark used increments count', db.getSound(id).use_count === 1);
  ok('Stats total', db.stats().total === 3);

  // 2. Path -> tags
  const tags = tagsFromPath('/lib', '/lib/footsteps/gravel/step_03.wav');
  ok('tagsFromPath derives folder+name tags', tags.includes('footsteps') && tags.includes('gravel') && tags.includes('step'), tags);

  // 1b. Thesaurus expansion: "rumble" finds the row tagged only "thunder storm"
  const { toFtsQuery } = require('../src/db');
  const fts = toFtsQuery('swish hit');
  ok('toFtsQuery expands synonym groups', /whoosh\*/.test(fts) && /impact\*/.test(fts) && /OR/.test(fts), fts.slice(0, 60) + '…');
  const viaSyn = db.search('rumble');
  ok('Synonym search hits sibling-tagged row', viaSyn.length === 1 && viaSyn[0].name.includes('thunder'), `${viaSyn.length} hit(s)`);
  // Regression: a bare term next to a synonym group must not throw FTS5 syntax error
  // ("background" expands to a group). Caught live via the Hermes Music Director.
  let ftsThrew = false;
  try { db.search('storm background music'); } catch { ftsThrew = true; }
  ok('Multi-term query with synonym group does not break FTS5', !ftsThrew);
  const sug = db.suggest('thu');
  ok('Vocab autocomplete suggests indexed terms', sug.includes('thunder'), sug.join(','));

  // 1c. Recent scope + sort options
  ok('Recent scope lists only used sounds', db.search('', { recentOnly: true }).length === 1 &&
     db.search('', { recentOnly: true })[0].id === id);
  ok('Stats counts recent', db.stats().recent === 1);
  const byDur = db.search('', { sort: 'duration' });
  ok('Sort by duration ascending', byDur[0].duration <= byDur[byDur.length - 1].duration,
     `${byDur[0].duration}s → ${byDur[byDur.length - 1].duration}s`);
  ok('Sort by most-used puts used row first', db.search('', { sort: 'used' })[0].id === id);

  // 1d. Inline metadata editing keeps FTS + scopes in sync
  db.updateMeta(id, { name: 'renamed_boom.wav', tags: 'boom explosion cinematic' });
  ok('updateMeta: old tag no longer matches', db.search('thunder').length === 0);
  ok('updateMeta: new tag searchable via FTS', db.search('boom').some((r) => r.id === id));
  db.updateMeta(id, { kind: 'music', genre: 'Trailer' });
  ok('updateMeta: kind flip lands in Music scope', db.search('', { kind: 'music' }).some((r) => r.id === id));
  db.updateMeta(id, { kind: 'sfx', genre: '', name: 'thunder_clap.wav', tags: 'thunder storm weather' }); // restore for later tests
  ok('updateMeta: empty string clears field to NULL', db.getSound(id).genre === null);
  // Custom-tag chips: additive add, then remove (the editor commits a joined string).
  // Distinctive tokens (no thesaurus synonyms) so FTS reflects the literal tag set.
  const cur = () => (db.getSound(id).tags || '').split(/\s+/).filter(Boolean);
  db.updateMeta(id, { tags: [...new Set([...cur(), 'customtagalpha', 'customtagbeta'])].join(' ') }); // add chips
  ok('tag chips: additive add keeps existing + adds new', db.search('customtagalpha').some((r) => r.id === id) && db.search('storm').some((r) => r.id === id));
  db.updateMeta(id, { tags: cur().filter((t) => t !== 'customtagalpha').join(' ') }); // remove one chip
  ok('tag chips: removing a chip drops it from FTS', db.search('customtagalpha').length === 0 && db.search('customtagbeta').some((r) => r.id === id));
  db.updateMeta(id, { tags: 'thunder storm weather' }); // restore

  // 2b. Music kind + Music scope
  db.upsertMany([
    { source: 'local', source_id: '/m/bed.wav', name: 'Cinematic Bed.wav', kind: 'music', artist: 'Akasi Studio', genre: 'Cinematic', bpm: 90, tags: 'cinematic bed akasi studio' },
  ]);
  const music = db.search('', { kind: 'music' });
  ok('Music scope returns music-kind rows', music.length === 1 && music[0].genre === 'Cinematic', `${music.length} row(s)`);
  ok('Music metadata persisted (bpm/artist)', music[0].bpm === 90 && music[0].artist === 'Akasi Studio');
  ok('Artist/genre searchable via FTS', db.search('cinematic').some((r) => r.kind === 'music'));
  ok('Stats counts music', db.stats().music === 1);

  // 2c. Collections
  const colId = db.createCollection('Trailer Cut');
  db.addToCollection(colId, thunder[0].id);
  db.addToCollection(colId, music[0].id);
  ok('Collection membership query', db.search('', { collectionId: colId }).length === 2);
  ok('listCollections reports count', db.listCollections().find((c) => c.id === colId)?.count === 2);
  db.removeFromCollection(colId, music[0].id);
  ok('Remove from collection', db.search('', { collectionId: colId }).length === 1);
  const colId2 = db.createCollection('Podcast Beds');
  db.addToCollection(colId2, thunder[0].id);
  ok('Sound in two collections', db.collectionsForSound(thunder[0].id).length === 2);
  db.deleteCollection(colId);
  ok('Delete collection cascades membership, keeps sound', db.listCollections().length === 1 && db.getSound(thunder[0].id) != null);

  // 2d. Batch ops
  const allIds = db.search('').map((r) => r.id);
  db.setFavoriteMany(allIds, true);
  ok('setFavoriteMany favorites all', db.stats().favorites === allIds.length, `${allIds.length} rows`);
  db.setFavoriteMany(allIds.slice(1), false);
  ok('setFavoriteMany un-favorites subset', db.stats().favorites === 1);
  const batchCol = db.createCollection('Batch Test');
  db.addManyToCollection(batchCol, allIds);
  ok('addManyToCollection adds all (dupes ignored)', db.listCollections().find((c) => c.id === batchCol)?.count === allIds.length);
  db.deleteCollection(batchCol);

  // 2d2. AI analysis fields + filters
  const sidecar = require('../src/sidecar');
  const mId = db.search('', { kind: 'music' })[0].id;
  const fakeEmb = Buffer.from(new Float32Array(512).fill(0.044).buffer);
  db.setAnalysis(mId, { bpm: 124, key: 'Gm', vocals: 0, ai_genre: 'Ambient', kind: 'music', embedding: fakeEmb });
  const analyzed = db.getSound(mId);
  ok('setAnalysis persists key/vocals/ai_genre/embedding', analyzed.key === 'Gm' && analyzed.vocals === 0 &&
     analyzed.ai_genre === 'Ambient' && Buffer.isBuffer(analyzed.embedding));
  ok('setAnalysis keeps tag-genre authoritative', analyzed.genre === 'Cinematic');
  ok('setAnalysis keeps tag-BPM authoritative (90 not overwritten)', analyzed.bpm === 90);
  ok('BPM range filter', db.search('', { bpmMin: 85, bpmMax: 95 }).some((r) => r.id === mId) &&
     !db.search('', { bpmMin: 140 }).some((r) => r.id === mId));
  ok('Vocals filter (instrumental)', db.search('', { vocals: 0 }).some((r) => r.id === mId));
  // NULL-tolerance: an un-analyzed row (no bpm/vocals) must survive bpm/vocals
  // filters — else filters nuke a library that hasn't been analyzed yet.
  const rawId = db.upsertMany([{ source: 'local', source_id: '/m/raw.wav', name: 'Unanalyzed Bed.wav', kind: 'music', tags: 'bed', duration: 60 }])[0];
  ok('Un-analyzed row survives BPM filter (NULL-tolerant)', db.search('', { bpmMin: 100, bpmMax: 130 }).some((r) => r.id === rawId));
  ok('Un-analyzed row survives instrumental filter (NULL-tolerant)', db.search('', { vocals: 0 }).some((r) => r.id === rawId));
  ok('Genre filter hits ai_genre too', db.search('', { genre: 'Ambient' }).some((r) => r.id === mId));
  ok('Duration bucket filter', db.search('', { durMin: 2, durMax: 15 }).every((r) => r.duration >= 2 && r.duration <= 15));
  ok('allEmbeddings returns the semantic index', db.allEmbeddings().some((r) => r.id === mId));
  ok('genres() unions tag + AI genres', db.genres().includes('Ambient') && db.genres().includes('Cinematic'));
  ok('cosine on stored blob ≈ 1 for identical vector', Math.abs(sidecar.cosine(fakeEmb, new Float32Array(512).fill(0.044)) - 512 * 0.044 * 0.044) < 0.01);

  // 2d3. Find Similar (in-library) — cosine nearest-neighbour over stored embeddings
  const { similarByEmbedding } = require('../src/search');
  const unit = (fill) => { const a = new Float32Array(512); fill(a); let n = 0; for (const x of a) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < 512; i++) a[i] /= n; return a; };
  const embBuf = (v) => Buffer.from(v.buffer.slice(0));
  const vT = unit((a) => { a[0] = 1; });
  const vNear = unit((a) => { a[0] = 1; a[1] = 0.25; });
  const vFar = unit((a) => { a[300] = 1; });
  const [tId, nId, fId] = db.upsertMany([
    { source: 'local', source_id: '/sim/target.wav', name: 'Sim Target.wav', kind: 'music', tags: 'target' },
    { source: 'local', source_id: '/sim/near.wav', name: 'Sim Near.wav', kind: 'music', tags: 'near' },
    { source: 'local', source_id: '/sim/far.wav', name: 'Sim Far.wav', kind: 'music', tags: 'far' },
  ]);
  db.setAnalysis(tId, { embedding: embBuf(vT) });
  db.setAnalysis(nId, { embedding: embBuf(vNear) });
  db.setAnalysis(fId, { embedding: embBuf(vFar) });
  const targetArr = db.getEmbeddingArray(tId);
  ok('getEmbeddingArray returns a 512-dim vector', Array.isArray(targetArr) && targetArr.length === 512 && Math.abs(targetArr[0] - 1) < 0.01);
  const sim = similarByEmbedding(db, sidecar, targetArr, { excludeId: tId, limit: 5 });
  ok('similarByEmbedding excludes the seed itself', !sim.some((r) => r.id === tId));
  ok('similarByEmbedding ranks nearest first', sim[0]?.id === nId);
  ok('similarByEmbedding ranks near above far', sim.findIndex((r) => r.id === nId) < sim.findIndex((r) => r.id === fId));
  ok('similarByEmbedding tags rows with _sim score + strips embedding blob', sim[0]?._sim > 0.9 && sim[0]?.embedding === undefined);
  ok('getSoundsByIds hydrates rows by id', db.getSoundsByIds([nId, fId]).get(nId)?.name === 'Sim Near.wav');
  // Match-a-sample path: an external embedding (no excludeId) ranks its closest library row first.
  const sample = similarByEmbedding(db, sidecar, Array.from(vNear), { limit: 3 });
  ok('similarByEmbedding (external sample) ranks the matching row first', sample[0]?.id === nId);

  // 2e. Credits manifest — the licensing deliverable
  const { buildManifest, classifyLicense } = require('../src/credits');
  ok('classifyLicense maps the license zoo', classifyLicense('http://creativecommons.org/licenses/by/4.0/') === 'cc-by' &&
     classifyLicense('http://creativecommons.org/licenses/by-nc/3.0/') === 'cc-by-nc' &&
     classifyLicense('http://creativecommons.org/publicdomain/zero/1.0/') === 'cc0' &&
     classifyLicense('ACE-Step 1.5 / Apache-2.0') === 'generated' && classifyLicense('local') === 'local');
  const creditRows = [
    { name: 'a.wav', source: 'local', license: 'local' },
    { name: 'b.wav', source: 'freesound', license: 'http://creativecommons.org/licenses/by/4.0/', attribution: '"b" by user (freesound.org/s/1)' },
    { name: 'c.wav', source: 'freesound', license: 'http://creativecommons.org/licenses/by-nc/3.0/', attribution: '"c" by other (freesound.org/s/2)' },
    { name: 'd.wav', source: 'generate', license: 'ACE-Step 1.5 / Apache-2.0', attribution: 'Generated · ACE-Step 1.5' },
  ];
  const full = buildManifest(creditRows, { title: 'Test credits' });
  ok('Manifest carries required attribution', full.markdown.includes('"b" by user') && full.markdown.includes('attribution required'));
  ok('Manifest flags NC as not client-safe', full.flagged.length === 1 && /INCLUDED — not client-safe/.test(full.markdown));
  const safe = buildManifest(creditRows, { clientSafe: true });
  ok('Client-safe export excludes NC', safe.count === 3 && safe.excluded && /EXCLUDED from this manifest/.test(safe.markdown));
  ok('CSV has header + included rows only', safe.csv.split('\n').length === 4);

  // 3. Live Freesound search (network + key)
  let remote = null;
  if (freesound.available()) {
    try {
      const r = await freesound.search('thunder', { pageSize: 5 });
      ok('Freesound live search', r.count > 0 && r.results.length > 0, `count=${r.count}`);
      remote = r.results.find((x) => x.url); // one with a preview url
      ok('Freesound result has license + attribution', Boolean(remote?.license && remote?.attribution), remote?.license);
      db.upsertMany(r.results);
      ok('Remote results indexed + searchable', db.search('thunder', { source: 'freesound' }).length > 0);
    } catch (e) {
      ok('Freesound live search', false, e.message);
    }
  } else {
    console.log('⏭️  Freesound skipped (FREESOUND_API_KEY not set)');
  }

  // 4. Cache download + 5. ffmpeg render
  if (remote?.url) {
    try {
      const cached = await ensureCached(path.join(tmp, 'cache'), remote, freesound.fetchPreview);
      ok('Preview cached to disk', fs.existsSync(cached) && fs.statSync(cached).size > 0, `${(fs.statSync(cached).size / 1024 | 0)} KB`);
      const meta = await audio.probe(cached);
      ok('ffprobe reads cached file', meta.duration > 0, `${meta.duration?.toFixed(2)}s @ ${meta.samplerate}Hz`);
      const wav = await audio.render(cached, { start: 0, end: Math.min(1.5, meta.duration || 1.5), fadeOut: 0.3, outDir: path.join(tmp, 'drops'), name: 'smoke_clip' });
      const wmeta = await audio.probe(wav);
      ok('ffmpeg render crop+fade -> WAV', fs.existsSync(wav) && wmeta.duration > 0 && wmeta.duration <= 1.6, `${wmeta.duration?.toFixed(2)}s`);

      // 5b. FX render engine: varispeed / reverse / gain baked correctly
      const fast = await audio.render(cached, { start: 0, end: 2, speed: 2, outDir: path.join(tmp, 'drops'), name: 'fx_fast' });
      const fmeta = await audio.probe(fast);
      ok('Varispeed 2x halves duration', fmeta.duration > 0.8 && fmeta.duration < 1.2, `${fmeta.duration?.toFixed(2)}s (from 2s crop)`);
      const rev = await audio.render(cached, { reverse: true, start: 0, end: 1.5, outDir: path.join(tmp, 'drops'), name: 'fx_rev' });
      const rmeta = await audio.probe(rev);
      ok('Reverse + crop-on-reversed-timeline', rmeta.duration > 1.3 && rmeta.duration < 1.7, `${rmeta.duration?.toFixed(2)}s`);
      const loud = await audio.render(cached, { start: 0, end: 1, gainDb: 6, fadeOut: 0.2, outDir: path.join(tmp, 'drops'), name: 'fx_gain' });
      ok('Gain + fade render succeeds', fs.existsSync(loud) && (await audio.probe(loud)).duration > 0.8);

      // 5c. Segment detection: 3 tone bursts split by silence → 3 regions
      const { execFile: ex } = require('node:child_process');
      const packFile = path.join(tmp, 'pack.wav');
      await new Promise((res, rej) => ex(audio.FFMPEG, ['-y', '-f', 'lavfi', '-i',
        "aevalsrc='if(lt(mod(t,1),0.5),0.8*sin(880*2*PI*t),0)':d=3", packFile],
        (e) => (e ? rej(e) : res())));
      const segs = await audio.detectSegments(packFile);
      ok('detectSegments splits variation pack into 3 takes', segs.length === 3, `${segs.length} segs: ${segs.map((s) => `${s.start.toFixed(2)}-${s.end.toFixed(2)}`).join(' ')}`);
      const solid = await audio.detectSegments(wav); // the cropped render — continuous audio
      ok('Continuous audio stays a single segment', solid.length === 1, `${solid.length} seg`);

      // 6. Inline-waveform peaks: real decode + DB blob roundtrip
      const peaks = await audio.pcmPeaks(cached);
      const nonzero = peaks ? [...peaks].filter((v) => v > 0).length : 0;
      ok('pcmPeaks computes 160-bucket envelope', peaks && peaks.length === 160 && nonzero > 20, `${nonzero} nonzero buckets`);
      const rid = db.search('thunder', { source: 'freesound' })[0]?.id;
      if (rid && peaks) {
        db.setPeaks(rid, peaks);
        const back = db.getSound(rid).peaks;
        ok('Peaks BLOB roundtrip via DB', Buffer.isBuffer(back) && back.length === 160 && back.equals(peaks));
      }
    } catch (e) {
      ok('Cache + render pipeline', false, e.message);
    }
  }

  // 6b. AI sidecar (only when the venv is installed): librosa BPM/key on fixtures
  if (sidecar.available()) {
    try {
      const { execFile: exf } = require('node:child_process');
      const click = path.join(tmp, 'click120.wav');
      const arp = path.join(tmp, 'cmajor.wav');
      await new Promise((res, rej) => exf(audio.FFMPEG, ['-y', '-f', 'lavfi', '-i',
        "aevalsrc='if(lt(mod(t,0.5),0.03),sin(1000*2*PI*t),0)':d=8", click], (e) => (e ? rej(e) : res())));
      await new Promise((res, rej) => exf(audio.FFMPEG, ['-y', '-f', 'lavfi', '-i',
        "aevalsrc='0.5*sin(261.63*2*PI*t)*lt(mod(t,2),0.5)+0.5*sin(329.63*2*PI*t)*between(mod(t,2),0.5,1)+0.5*sin(392*2*PI*t)*between(mod(t,2),1,1.5)+0.5*sin(523.25*2*PI*t)*gte(mod(t,2),1.5)':d=8", arp], (e) => (e ? rej(e) : res())));
      const dsp = await sidecar.analyzeBatch([click, arp]);
      const c = dsp.get(click), a = dsp.get(arp);
      ok('Sidecar BPM detection near 120', c?.bpm > 110 && c?.bpm < 130, `${c?.bpm} BPM`);
      ok('Sidecar key detection: C major arpeggio → C', a?.key === 'C', a?.key);
    } catch (e) {
      ok('AI sidecar DSP', false, e.message);
    }
  } else {
    console.log('⏭️  AI sidecar skipped (sidecar/setup.sh not run)');
  }

  // 7. Spectrogram DSP (renderer lib, imported dynamically — it's ESM)
  try {
    const { pathToFileURL } = require('node:url');
    const specMod = await import(pathToFileURL(path.join(__dirname, '..', 'renderer', 'lib', 'spectrogram.mjs')).href);
    // 2s @ 8kHz: first second 200Hz, second second 3kHz — energy must move UP in frequency.
    const sr = 8000, N = sr * 2;
    const sig = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const f = i < N / 2 ? 200 : 3000;
      sig[i] = Math.sin((2 * Math.PI * f * i) / sr);
    }
    const spec = specMod.computeSpectrogram(sig, { fftSize: 256, cols: 64, bins: 128 });
    const domBin = (col) => {
      let best = 0, bi = 0;
      for (let b = 0; b < spec.bins; b++) {
        const v = spec.data[col * spec.bins + b];
        if (v > best) { best = v; bi = b; }
      }
      return bi;
    };
    const early = domBin(8), late = domBin(spec.cols - 8);
    // Expected bins: 200Hz → ~6, 3000Hz → ~96 (bin ≈ f*fftSize/sr)
    ok('Spectrogram: dominant bin tracks frequency', early >= 4 && early <= 9 && late >= 90 && late <= 102,
       `200Hz→bin ${early}, 3kHz→bin ${late}`);
  } catch (e) {
    ok('Spectrogram DSP', false, e.message);
  }

  // 2f. Music Director tool loop (mock LLM — no network). Proves the loop can only
  // ever surface REAL library rows, tallies usage, and both architectures work.
  const { runDirector } = require('../src/director');
  let gturn = 0;
  const groundedChat = async () => {
    gturn++;
    if (gturn === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_sounds', arguments: JSON.stringify({ query: 'weather', limit: 5 }) } }] }, usage: { prompt_tokens: 10, completion_tokens: 5 } };
    return { message: { role: 'assistant', content: '**top pick** from the results' }, usage: { prompt_tokens: 8, completion_tokens: 4 } };
  };
  const gres = await runDirector({ db, sidecar, clapReady: false, messages: [{ role: 'user', content: 'weather sounds' }], chat: groundedChat });
  ok('director (grounded): pool holds only REAL library rows', gres.pool.length > 0 && gres.pool.every((r) => db.getSound(r.id) != null));
  ok('director (grounded): returns a final cue sheet in 2 steps', /top pick/.test(gres.text) && gres.steps === 2);
  ok('director (grounded): tallies usage tokens across steps', gres.usage.prompt_tokens === 18 && gres.usage.completion_tokens === 9);
  ok('director (grounded): pool rows carry no embedding blob', gres.pool.every((r) => r.embedding === undefined));

  const retrieverChat = async () => ({ message: { content: 'weather' }, usage: { prompt_tokens: 3, completion_tokens: 2 } });
  const judgeChat = async () => ({ message: { content: '**judged pick** from the pool' }, usage: { prompt_tokens: 6, completion_tokens: 3 } });
  const tres = await runDirector({ db, sidecar, clapReady: false, mode: 'triad', messages: [{ role: 'user', content: 'weather' }], chat: judgeChat, retrieverChat });
  ok('director (triad): judge picks from a real merged pool', tres.mode === 'triad' && tres.pool.length > 0 && tres.pool.every((r) => db.getSound(r.id) != null));
  ok('director (triad): returns judged cue sheet in 3 steps', /judged pick/.test(tres.text) && tres.steps === 3);

  // 2f2. Director reaches ONLINE libraries when wired — hits pool as real rows.
  const { buildTools } = require('../src/director');
  ok('director: search_online tool offered only when remoteSearch is wired',
    buildTools(true).some((t) => t.function.name === 'search_online') && !buildTools(false).some((t) => t.function.name === 'search_online'));
  let fturn = 0;
  const fsChat = async () => {
    fturn++;
    if (fturn === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'f1', type: 'function', function: { name: 'search_online', arguments: JSON.stringify({ query: 'tension' }) } }] }, usage: { prompt_tokens: 5, completion_tokens: 2 } };
    return { message: { role: 'assistant', content: '**Online Tension Bed.mp3** — CC-BY, credit required.' }, usage: { prompt_tokens: 4, completion_tokens: 2 } };
  };
  const remoteSearch = async () => {
    // Simulate main.js merging providers: a Jamendo music track lands in the index.
    const rid = db.upsertMany([{ source: 'jamendo', source_id: 'jm-tension-1', name: 'Online Tension Bed.mp3', url: 'http://x/p.mp3', kind: 'music', artist: 'CC Artist', genre: 'Cinematic', license: 'http://creativecommons.org/licenses/by/4.0/', tags: 'tension dark bed cinematic' }])[0];
    return { count: 1, results: [db.getSound(rid)] };
  };
  const fres = await runDirector({ db, sidecar, clapReady: false, messages: [{ role: 'user', content: 'tension bed' }], chat: fsChat, remoteSearch });
  ok('director: online hits land in the candidate pool as real rows', fres.pool.some((r) => r.source === 'jamendo') && fres.pool.every((r) => db.getSound(r.id) != null));

  // 2f3. Jamendo provider: maps a track to a music-kind index row (pure, no network).
  const jamendo = require('../src/providers/jamendo');
  const jrow = jamendo.normalize({
    id: '999', name: 'Dark Tension', duration: 142, artist_name: 'Niight', album_name: 'Shadows',
    license_ccurl: 'http://creativecommons.org/licenses/by-nc/3.0/', audio: 'https://prod.jamendo/track.mp3',
    musicinfo: { tags: { genres: ['cinematic'], instruments: ['strings'] } },
  });
  ok('jamendo.normalize → music-kind row with artist/genre/url', jrow.kind === 'music' && jrow.artist === 'Niight' && jrow.genre === 'Cinematic' && jrow.url.endsWith('.mp3') && /tension|cinematic|strings/.test(jrow.tags));
  const pixabay = require('../src/providers/pixabay');
  ok('pixabay provider is an inert stub (unavailable until headless)', pixabay.available() === false);

  // 2f4. Scoring Playbook grounding — present in the director's system context, honesty intact.
  const { SCORING_PLAYBOOK, PLAYBOOK_SENTINEL } = require('../src/playbook');
  const director = require('../src/director');
  ok('playbook: sentinel + all four delivery formats present', SCORING_PLAYBOOK.includes(PLAYBOOK_SENTINEL) &&
    ['Film', 'TV', 'Commercial', 'Short-form'].every((f) => SCORING_PLAYBOOK.includes(f)));
  ok('playbook: wired into director SYSTEM + JUDGE_SYSTEM', director.SYSTEM.includes(PLAYBOOK_SENTINEL) && director.JUDGE_SYSTEM.includes(PLAYBOOK_SENTINEL));

  // 2f5. Tier-1 generation prompt-writer (pure builder + director tool).
  const genprompt = require('../src/genprompt');
  const gpBed = genprompt.buildGenerationPrompt({ brief: 'a tense instrumental bed under 90 BPM for a promo' });
  ok('genprompt: brief → structured prompt (instrumental, tension, bed duration)',
    gpBed.caption.length > 0 && gpBed.instrumental === true && gpBed.genre === 'Tension' && gpBed.suggestedDurationSec === 60);
  const gpSample = genprompt.buildGenerationPrompt({ brief: 'make something like this', sample: { genre: 'Lo-Fi', vocals: 0, bpm: 82, key: 'Am' } });
  ok('genprompt: analyzed sample attributes override brief guesses',
    gpSample.genre === 'Lo-Fi' && gpSample.bpm === 82 && /82 BPM/.test(gpSample.caption) && /Am/.test(gpSample.caption));
  const gpSting = genprompt.buildGenerationPrompt({ brief: 'a short cinematic logo sting at 128 bpm' });
  ok('genprompt: sting duration + explicit BPM parsed', gpSting.suggestedDurationSec === 8 && gpSting.bpm === 128 && gpSting.genre === 'Cinematic');
  // Director tool path (mock LLM calls write_generation_prompt, brief-only, no sample).
  let wgpTurn = 0;
  const wgpChat = async () => {
    wgpTurn++;
    if (wgpTurn === 1) return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_generation_prompt', arguments: JSON.stringify({ brief: 'dark ambient underscore' }) } }] }, usage: { prompt_tokens: 4, completion_tokens: 2 } };
    return { message: { role: 'assistant', content: 'Here is a generation prompt you can use.' }, usage: { prompt_tokens: 3, completion_tokens: 2 } };
  };
  const wgpRes = await runDirector({ db, sidecar, clapReady: false, messages: [{ role: 'user', content: 'generate a dark ambient bed' }], chat: wgpChat });
  ok('director: write_generation_prompt tool runs without a live generator', /generation prompt/.test(wgpRes.text) && wgpRes.steps === 2);
  ok('director: write_generation_prompt is offered in the base toolset', buildTools(false).some((t) => t.function.name === 'write_generation_prompt'));

  // 2g. Bake-off honesty checker — the guard against fabricated filenames.
  const { honestyReport } = require('./director-bakeoff');
  const hp = [{ name: 'Thunder Clap.wav' }, { name: 'Rain Light.wav' }];
  const hGood = honestyReport('My top pick is **Thunder Clap.wav** — great storm hit.', hp);
  ok('honestyReport: a real named pick is honest', hGood.honest && hGood.matched.length === 1 && hGood.fabricated.length === 0);
  const hBad = honestyReport('Try **Epic Dragon Roar.wav** for the intro.', hp);
  ok('honestyReport: an invented filename is flagged dishonest', !hBad.honest && hBad.fabricated.length === 1);
  const hEmph = honestyReport('Here is my **top recommendation** from the pool.', hp);
  ok('honestyReport: non-file emphasis is not mistaken for a claim', hEmph.honest && hEmph.claims.length === 0);

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
