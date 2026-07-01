'use strict';
/**
 * Akasi Sounds main process — owns the index, providers, and (crucially) the native
 * drag-out to the OS so sounds land in Premiere/Resolve/FCP as real clips.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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

// Return a file:// path playable in the renderer <audio> (caches remote previews).
ipcMain.handle('audio:resolve', async (_e, id) => {
  const s = db.getSound(id);
  if (!s) throw new Error('not found');
  const local = await ensureCached(cacheDir(), s, freesound.fetchPreview);
  if (s.source !== 'local' && local !== s.cached_path) db.setCachedPath(id, local);
  return { path: local };
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
      outDir: dropDir(),
      name: s.name,
    });
    db.markUsed(id);
    e.sender.startDrag({ file, icon: DRAG_ICON });
  } catch (err) {
    win.webContents.send('drag:error', String(err));
  }
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));
