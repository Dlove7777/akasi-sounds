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

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
