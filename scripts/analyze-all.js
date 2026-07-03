'use strict';
/**
 * Headless library analysis — the same pipeline as the app's ⚡ Analyze button,
 * runnable outside the GUI. librosa BPM/key (one batch) + CLAP classify (genre /
 * vocals / sfx-vs-music) + embeddings per file → db.setAnalysis. Incremental:
 * only rows with analyzed_at IS NULL. All local (sidecar venv).
 *
 * Run:  ELECTRON_RUN_AS_NODE=1 <electron> scripts/analyze-all.js
 * (or via scripts/analyze-all.sh)
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { openDb } = require('../src/db');
const sidecar = require('../src/sidecar');

const DB_PATH = process.env.AKASI_SOUNDS_DB ||
  path.join(os.homedir(), 'Library', 'Application Support', 'Akasi Sounds', 'akasi-sounds-index.db');

(async () => {
  if (!sidecar.available()) { console.error('sidecar venv missing — run sidecar/setup.sh'); process.exit(1); }
  if (!fs.existsSync(DB_PATH)) { console.error('DB not found:', DB_PATH); process.exit(1); }

  const db = openDb(DB_PATH);
  db.db.pragma('busy_timeout = 15000'); // coexist with the app if it's open (WAL)

  const todo = db.needAnalysis().map((r) => ({ ...r, file: [r.path, r.cached_path].find((p) => p && fs.existsSync(p)) })).filter((r) => r.file);
  if (!todo.length) { console.log('Nothing to analyze — all files already enriched.'); db.close(); return; }
  console.log(`Analyzing ${todo.length} files (local: librosa + CLAP)…`);

  const t0 = Date.now();
  process.stdout.write('  [1/2] BPM + key (librosa batch)… ');
  const dsp = await sidecar.analyzeBatch(todo.map((r) => r.file));
  console.log(`done (${dsp.size} probed)`);

  console.log('  [2/2] CLAP classify + embed…');
  let done = 0, music = 0, sfxFlip = 0, errs = 0;
  for (const r of todo) {
    const d = dsp.get(r.file) || {};
    let ai = {};
    try {
      const c = await sidecar.classify(r.file);
      if (!c.error) {
        if (c.kind === 'music') music++;
        ai = {
          kind: c.kind,
          vocals: c.vocals ?? null,
          ai_genre: c.genre ?? null,
          embedding: c.embedding ? Buffer.from(new Float32Array(c.embedding).buffer) : null,
        };
      } else errs++;
    } catch { errs++; }
    db.setAnalysis(r.id, {
      bpm: ai.kind === 'music' || !ai.kind ? d.bpm ?? null : null,
      key: d.key ?? null,
      ...ai,
    });
    done += 1;
    if (done % 20 === 0 || done === todo.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      const eta = Math.round((todo.length - done) / Math.max(rate, 0.01));
      process.stdout.write(`\r    ${done}/${todo.length}  (${music} music · ${errs} errors · ~${eta}s left)   `);
    }
  }
  console.log(`\nDone in ${Math.round((Date.now() - t0) / 1000)}s. Analyzed ${done}, music=${music}, errors=${errs}.`);
  db.close();
  process.exit(0);
})();
