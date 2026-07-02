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

ipcMain.handle('lib:search', (_e, { query, opts }) => db.search(query, opts || {}));
ipcMain.handle('lib:stats', () => db.stats());
ipcMain.handle('lib:favorite', (_e, id) => db.toggleFavorite(id));
ipcMain.handle('lib:folders', () => db.listFolders());
ipcMain.handle('providers:list', () => providers.availableProviders());
ipcMain.handle('lib:suggest', (_e, prefix) => db.suggest(prefix));
ipcMain.handle('lib:update', (_e, { id, fields }) => db.updateMeta(id, fields || {}));
ipcMain.handle('lib:favMany', (_e, { ids, on }) => db.setFavoriteMany(ids || [], !!on));
ipcMain.handle('col:addMany', (_e, { collectionId, ids }) => db.addManyToCollection(collectionId, ids || []));

/* -------------------------- IPC: collections -------------------------- */

ipcMain.handle('col:list', () => db.listCollections());
ipcMain.handle('col:create', (_e, name) => db.createCollection(name));
ipcMain.handle('col:rename', (_e, { id, name }) => db.renameCollection(id, name));
ipcMain.handle('col:delete', (_e, id) => db.deleteCollection(id));
ipcMain.handle('col:add', (_e, { collectionId, soundId }) => db.addToCollection(collectionId, soundId));
ipcMain.handle('col:remove', (_e, { collectionId, soundId }) => db.removeFromCollection(collectionId, soundId));
ipcMain.handle('col:forSound', (_e, soundId) => db.collectionsForSound(soundId));

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
