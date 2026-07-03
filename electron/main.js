'use strict';
/**
 * Akasi Sounds main process — owns the index, providers, and (crucially) the native
 * drag-out to the OS so sounds land in Premiere/Resolve/FCP as real clips.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, protocol, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Serve local audio through a privileged custom scheme. In dev the renderer origin
// is http://localhost, and Electron's webSecurity blocks loading file:// media/fetch
// from an http origin — which silently kills both playback and waveform decode. A
// privileged scheme works identically in dev and packaged builds.
protocol.registerSchemesAsPrivileged([
  { scheme: 'akmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);
const mediaUrl = (absPath) => `akmedia://audio/${encodeURIComponent(absPath)}`;

const { openDb } = require('../src/db');
const { buildManifest } = require('../src/credits');
const sidecar = require('../src/sidecar');
const { blendedSearch, similarByEmbedding } = require('../src/search');
const { runDirector } = require('../src/director');
const generateProvider = require('../src/providers/generate');
const providers = require('../src/providers');
const freesound = require('../src/providers/freesound');
const { scanFolder } = require('../src/indexer');
const { ensureCached } = require('../src/cache');
const audio = require('../src/audio');

// Load ~/.secrets.env keys into env (dev convenience; prod uses in-app settings).
try {
  for (const line of fs.readFileSync(path.join(app.getPath('home'), '.secrets.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* optional */ }

const isDev = process.env.AKASI_DEV === '1';
let db;
let win;

function dataDir() {
  const d = app.getPath('userData');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const cacheDir = () => path.join(dataDir(), 'preview-cache');
const dropDir = () => path.join(dataDir(), 'drops');

// A tiny valid PNG so webContents.startDrag always has an icon (macOS requires one).
const DRAG_ICON = nativeImage.createFromDataURL(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR4nGP8z8Dwn4ECwESJ5lEDRg0YNWDUgFEDRg0YNWDUgFEDBgIAABEEAwEqZ3jbAAAAAElFTkSuQmCC'
);

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#0e0f13',
    titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: false },
  });
  if (isDev) {
    win.loadURL('http://localhost:5273');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  db = openDb(path.join(dataDir(), 'akasi-sounds-index.db'));
  // Map akmedia://audio/<encoded-abs-path> → the real file on disk.
  protocol.handle('akmedia', (request) => {
    const encoded = new URL(request.url).pathname.replace(/^\//, '');
    const filePath = decodeURIComponent(encoded);
    return net.fetch(pathToFileURL(filePath).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});

/* ---------------------------- IPC: library ---------------------------- */

// Search: FTS keyword base, blended with CLAP semantic similarity when the AI
// sidecar is up and the sort is relevance. Semantic-only hits (no keyword match)
// join the results; every row still respects the scope filters.
let clapReady = false;
ipcMain.handle('lib:search', (_e, { query, opts }) => blendedSearch(db, sidecar, query, opts || {}, clapReady));
ipcMain.handle('lib:stats', () => db.stats());
ipcMain.handle('lib:favorite', (_e, id) => db.toggleFavorite(id));
ipcMain.handle('lib:folders', () => db.listFolders());
ipcMain.handle('providers:list', () => providers.availableProviders());
ipcMain.handle('lib:suggest', (_e, prefix) => db.suggest(prefix));
ipcMain.handle('lib:update', (_e, { id, fields }) => db.updateMeta(id, fields || {}));
ipcMain.handle('lib:favMany', (_e, { ids, on }) => db.setFavoriteMany(ids || [], !!on));
ipcMain.handle('col:addMany', (_e, { collectionId, ids }) => db.addManyToCollection(collectionId, ids || []));

// Find Similar (in-library): cosine of a row's stored CLAP embedding against the
// whole analyzed library. No CLAP warm-up needed — the blobs are already on disk.
ipcMain.handle('similar:byId', (_e, { id, limit }) => {
  const target = db.getEmbeddingArray(id);
  if (!target) return { error: 'This sound has no AI fingerprint yet — run ⚡ Analyze first.', results: [] };
  return { results: similarByEmbedding(db, sidecar, target, { limit: limit || 40, excludeId: id }) };
});

// Match Sample: embed ANY external audio file with CLAP, then cosine it against the
// library — "find me sounds like this one". Needs the sidecar warm (embeds live).
const AUDIO_EXTS = ['wav', 'mp3', 'aiff', 'aif', 'flac', 'm4a', 'ogg', 'opus', 'wma'];
ipcMain.handle('similar:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Pick an audio sample to match',
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXTS }],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  return { path: r.filePaths[0] };
});
ipcMain.handle('similar:byFile', async (_e, { path: p, limit }) => {
  if (!p || !fs.existsSync(p)) return { error: 'File not found.', results: [] };
  if (!sidecar.available()) return { error: 'AI sidecar not installed — run sidecar/setup.sh', results: [] };
  let r;
  try { r = await sidecar.embedAudio(p); } catch (e) { return { error: String(e.message || e), results: [] }; }
  if (!r?.embedding) return { error: r?.error || 'Could not analyze that file.', results: [] };
  return { results: similarByEmbedding(db, sidecar, r.embedding, { limit: limit || 40 }) };
});

/* -------------------------- IPC: collections -------------------------- */

ipcMain.handle('col:list', () => db.listCollections());
ipcMain.handle('col:create', (_e, name) => db.createCollection(name));
ipcMain.handle('col:rename', (_e, { id, name }) => db.renameCollection(id, name));
ipcMain.handle('col:delete', (_e, id) => db.deleteCollection(id));
ipcMain.handle('col:add', (_e, { collectionId, soundId }) => db.addToCollection(collectionId, soundId));
ipcMain.handle('col:remove', (_e, { collectionId, soundId }) => db.removeFromCollection(collectionId, soundId));
ipcMain.handle('col:forSound', (_e, soundId) => db.collectionsForSound(soundId));

/* --------------------------- IPC: AI analysis -------------------------- */

ipcMain.handle('ai:status', () => ({ installed: sidecar.available(), ready: clapReady, director: !!process.env.OPENROUTER_API_KEY }));
ipcMain.handle('lib:genres', () => db.genres());

/* ----------------------------- IPC: generation ------------------------- */

// Generate a track on VIDI (ACE-Step), save it, index it as a source='generate'
// row, and analyze it so it's immediately auditionable, draggable, find-similar-able.
// Deliberately NOT part of the search_online fan-out (KTD4) — explicit only.
const genDir = () => path.join(dataDir(), 'generated');

async function runGeneration(spec, onStatus) {
  const r = await generateProvider.generate(spec, { onStatus });
  const id = await generateProvider.materialize(
    db, { bytes: r.bytes, ext: r.ext, caption: spec.caption, durationSec: spec.durationSec, seed: spec.seed }, genDir()
  );
  try {
    const file = db.getSound(id).path;
    const dsp = await sidecar.analyzeBatch([file]).catch(() => new Map());
    const d = dsp.get(file) || {};
    let ai = {};
    const c = await sidecar.classify(file).catch(() => null);
    if (c && !c.error) {
      ai = { vocals: c.vocals ?? null, ai_genre: c.genre ?? null, embedding: c.embedding ? Buffer.from(new Float32Array(c.embedding).buffer) : null };
    }
    db.setAnalysis(id, { bpm: d.bpm ?? null, key: d.key ?? null, ...ai });
  } catch { /* generation is valid even if analysis fails */ }
  return db.getSound(id);
}

ipcMain.handle('generate:status', () => ({ available: generateProvider.available(), url: generateProvider.baseUrl() || null }));
ipcMain.handle('generate:run', async (_e, spec) => {
  if (!generateProvider.available()) return { error: 'Generation unavailable — set VIDI_ACESTEP_URL in ~/.secrets.env.' };
  try {
    const row = await runGeneration(spec || {}, (s) => win?.webContents.send('generate:progress', { status: s }));
    const { embedding, ...clean } = row;
    return { row: clean };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

/* --------------------------- IPC: Music Director ----------------------- */

// In-app Music Director chat. OpenRouter brain drives a tool loop over the REAL
// library (blendedSearch in-process) — picks can only be files a tool returned.
// Live pool/tool events stream to the renderer; the final cue sheet is the resolve.
ipcMain.handle('director:chat', async (_e, { messages, opts }) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { error: 'No OPENROUTER_API_KEY found — add it to ~/.secrets.env to use the Music Director.' };
  try {
    const r = await runDirector({
      db, sidecar, clapReady,
      messages: messages || [],
      mode: opts?.mode || 'grounded',
      model: opts?.model || undefined,
      retrieverModel: opts?.retrieverModel || undefined,
      apiKey,
      // Ground a generation prompt in a real analyzed reference file (CLAP + librosa).
      analyzeSample: async (p) => {
        if (!sidecar.available() || !p || !fs.existsSync(p)) return null;
        const c = await sidecar.classify(p).catch(() => null);
        const dsp = await sidecar.analyzeBatch([p]).catch(() => new Map());
        const d = dsp.get(p) || {};
        return c && !c.error ? { genre: c.genre, vocals: c.vocals ?? null, bpm: d.bpm ?? null, key: d.key ?? null } : null;
      },
      // Let the director actually generate (ACE-Step on VIDI) when connected.
      generate: generateProvider.available()
        ? (spec, onStatus) => runGeneration(spec, onStatus)
        : undefined,
      // Give the Director every connected online library — folds hits from all
      // available providers (Freesound SFX + Jamendo music) into the index so its
      // picks become real, draggable rows (previews cache on drag).
      remoteSearch: async (query, limit) => {
        const avail = providers.availableProviders();
        if (!avail.length) return { error: 'No online libraries connected (set a provider API key).', results: [] };
        const merged = [];
        const per = Math.max(6, Math.floor((limit || 24) / avail.length));
        for (const { id } of avail) {
          try {
            const res = await providers.get(id).search(query, { page: 1, pageSize: Math.min(per, 30) });
            for (const rid of db.upsertMany(res.results || [])) {
              const row = db.getSound(rid);
              if (row) merged.push(row);
            }
          } catch { /* one provider failing shouldn't sink the rest */ }
        }
        return { count: merged.length, results: merged.slice(0, limit || 24) };
      },
      onEvent: (evt) => win?.webContents.send('director:event', evt),
    });
    return { text: r.text, pool: r.pool, steps: r.steps, usage: r.usage, mode: r.mode };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// Warm the CLAP model in the background shortly after launch (no-op if venv absent).
app.whenReady().then(() => {
  if (!sidecar.available()) return;
  setTimeout(() => {
    sidecar.startClap()
      .then(() => { clapReady = true; win?.webContents.send('ai:ready'); })
      .catch(() => { /* stays keyword-only */ });
  }, 3000);
});

// Analyze Library: librosa BPM/key in one batch, then CLAP classify+embed per file.
let analyzeRunning = false;
ipcMain.handle('analyze:run', async () => {
  if (analyzeRunning) return { error: 'analysis already running' };
  if (!sidecar.available()) return { error: 'AI sidecar not installed — run sidecar/setup.sh' };
  analyzeRunning = true;
  try {
    const todo = db.needAnalysis();
    if (!todo.length) return { done: 0, total: 0 };
    const fileOf = (r) => [r.path, r.cached_path].find((p) => p && fs.existsSync(p));
    const withFiles = todo.map((r) => ({ ...r, file: fileOf(r) })).filter((r) => r.file);
    win?.webContents.send('analyze:progress', { phase: 'bpm/key', done: 0, total: withFiles.length });

    const dsp = await sidecar.analyzeBatch(withFiles.map((r) => r.file));

    let done = 0;
    for (const r of withFiles) {
      const d = dsp.get(r.file) || {};
      let ai = {};
      try {
        const c = await sidecar.classify(r.file);
        if (!c.error) {
          ai = {
            kind: c.kind,
            vocals: c.vocals ?? null,
            ai_genre: c.genre ?? null,
            embedding: c.embedding ? Buffer.from(new Float32Array(c.embedding).buffer) : null,
          };
        }
      } catch { /* keep DSP-only result */ }
      db.setAnalysis(r.id, {
        bpm: ai.kind === 'music' || !ai.kind ? d.bpm ?? null : null, // BPM on sfx is noise
        key: d.key ?? null,
        ...ai,
      });
      done += 1;
      if (done % 5 === 0 || done === withFiles.length) {
        win?.webContents.send('analyze:progress', { phase: 'ai', done, total: withFiles.length, current: r.name });
      }
    }
    return { done, total: withFiles.length };
  } finally {
    analyzeRunning = false;
  }
});

/* ------------------------- IPC: credits export ------------------------ */

// Export an attribution manifest (.md + .csv) for a collection or the used-set.
// clientSafe excludes CC-BY-NC material and flags it instead of shipping it.
ipcMain.handle('credits:export', async (_e, { collectionId, recentOnly, clientSafe, title }) => {
  const rows = db.search('', collectionId ? { collectionId, limit: 2000 } : { recentOnly: true, limit: 2000 });
  if (!rows.length) return { error: 'Nothing to export in this scope.' };
  const manifest = buildManifest(rows, { title: title || 'Audio credits — Akasi Sounds', clientSafe });
  const r = await dialog.showSaveDialog(win, {
    title: 'Export credits manifest',
    defaultPath: path.join(app.getPath('documents'), 'audio-credits.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  fs.writeFileSync(r.filePath, manifest.markdown);
  const csvPath = r.filePath.replace(/\.md$/, '') + '.csv';
  fs.writeFileSync(csvPath, manifest.csv);
  shell.showItemInFolder(r.filePath);
  return { path: r.filePath, csvPath, count: manifest.count, flagged: manifest.flagged.length, excluded: manifest.excluded };
});

ipcMain.handle('folders:add', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return { canceled: true };
  const added = [];
  for (const root of r.filePaths) {
    const res = await scanFolder(db, root, (p) => win.webContents.send('scan:progress', { root, ...p }));
    added.push({ root, ...res });
  }
  return { added };
});

/* ------------------------ IPC: remote providers ----------------------- */

ipcMain.handle('remote:search', async (_e, { provider, query, page }) => {
  const p = providers.get(provider);
  if (!p || !p.available()) return { error: `${provider} unavailable (no API key)` };
  const r = await p.search(query, { page: page || 1, pageSize: 40 });
  db.upsertMany(r.results); // fold remote hits into the index so they persist
  return { count: r.count, results: db.search(query, { source: provider, limit: 40 }) };
});

/* ------------------------- IPC: audition / drag ----------------------- */

// Lazy inline-waveform peaks. Computed once per sound from its local/cached file
// and stored in the DB; remote sounds without a cached preview return null (we
// never auto-download the library just to draw rows). Concurrency-gated so a
// screenful of virtualized rows doesn't spawn 20 ffmpeg processes at once.
let peaksActive = 0;
const peaksQueue = [];
function withPeaksSlot(fn) {
  return new Promise((resolve) => {
    const run = async () => {
      peaksActive++;
      try { resolve(await fn()); } catch { resolve(null); }
      peaksActive--;
      const next = peaksQueue.shift();
      if (next) next();
    };
    peaksActive < 3 ? run() : peaksQueue.push(run);
  });
}

ipcMain.handle('audio:peaks', async (_e, id) => {
  const s = db.getSound(id);
  if (!s) return null;
  if (s.peaks) return s.peaks;
  const file = [s.path, s.cached_path].find((p) => p && fs.existsSync(p));
  if (!file) return null;
  return withPeaksSlot(async () => {
    const buf = await audio.pcmPeaks(file);
    if (buf) db.setPeaks(id, buf);
    return buf;
  });
});

// Segments — non-silent regions of a file (variation packs). Session-cached.
const segCache = new Map();
ipcMain.handle('audio:segments', async (_e, id) => {
  if (segCache.has(id)) return segCache.get(id);
  const s = db.getSound(id);
  if (!s) return [];
  const file = [s.path, s.cached_path].find((p) => p && fs.existsSync(p));
  if (!file) return [];
  const segs = await withPeaksSlot(() => audio.detectSegments(file));
  segCache.set(id, segs || []);
  return segs || [];
});

// Return a playable URL for the renderer <audio> (caches remote previews).
// fx.reverse → serve an ffmpeg-reversed temp render (cached per sound) so the
// audition is honest: what you hear reversed is exactly what the drag will bake.
const fxDir = () => path.join(dataDir(), 'fx-cache');
ipcMain.handle('audio:resolve', async (_e, id, fx) => {
  const s = db.getSound(id);
  if (!s) throw new Error('not found');
  const local = await ensureCached(cacheDir(), s, freesound.fetchPreview);
  if (s.source !== 'local' && local !== s.cached_path) db.setCachedPath(id, local);
  if (fx?.reverse) {
    const rev = path.join(fxDir(), `rev_${id}.wav`);
    if (!fs.existsSync(rev)) {
      await audio.render(local, { reverse: true, outDir: fxDir(), name: `rev_${id}` });
    }
    return { path: rev, url: mediaUrl(rev) };
  }
  return { path: local, url: mediaUrl(local) };
});

// Native OS drag: render (optionally cropped/faded) WAV, then hand it to the OS.
ipcMain.on('drag:start', async (e, { id, selection }) => {
  try {
    const s = db.getSound(id);
    if (!s) return;
    const src = await ensureCached(cacheDir(), s, freesound.fetchPreview);
    const file = await audio.render(src, {
      start: selection?.start,
      end: selection?.end,
      fadeIn: selection?.fadeIn,
      fadeOut: selection?.fadeOut,
      speed: selection?.speed,
      reverse: selection?.reverse,
      gainDb: selection?.gainDb,
      outDir: dropDir(),
      name: s.name,
    });
    db.markUsed(id);
    e.sender.startDrag({ file, icon: DRAG_ICON });
  } catch (err) {
    win.webContents.send('drag:error', String(err));
  }
});

// Multi-file native drag: hands the OS the ORIGINAL files (local path or cached
// preview) — no crop/FX for batch drags; those are single-sound player features.
ipcMain.on('drag:startMany', async (e, ids) => {
  try {
    const files = [];
    for (const id of ids || []) {
      const s = db.getSound(id);
      if (!s) continue;
      let file = [s.path, s.cached_path].find((p) => p && fs.existsSync(p));
      if (!file && s.url) {
        try { file = await ensureCached(cacheDir(), s, freesound.fetchPreview); } catch { /* skip */ }
      }
      if (file) { files.push(file); db.markUsed(id); }
    }
    if (files.length) e.sender.startDrag({ files, icon: DRAG_ICON });
  } catch (err) {
    win.webContents.send('drag:error', String(err));
  }
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
