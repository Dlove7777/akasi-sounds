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
    } catch (e) {
      ok('Cache + render pipeline', false, e.message);
    }
  }

  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
