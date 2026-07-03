'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('akasi', {
  search: (query, opts) => ipcRenderer.invoke('lib:search', { query, opts }),
  stats: () => ipcRenderer.invoke('lib:stats'),
  toggleFavorite: (id) => ipcRenderer.invoke('lib:favorite', id),
  listFolders: () => ipcRenderer.invoke('lib:folders'),
  addFolders: () => ipcRenderer.invoke('folders:add'),
  providers: () => ipcRenderer.invoke('providers:list'),
  suggest: (prefix) => ipcRenderer.invoke('lib:suggest', prefix),
  updateMeta: (id, fields) => ipcRenderer.invoke('lib:update', { id, fields }),
  setFavoriteMany: (ids, on) => ipcRenderer.invoke('lib:favMany', { ids, on }),
  addManyToCollection: (collectionId, ids) => ipcRenderer.invoke('col:addMany', { collectionId, ids }),
  findSimilar: (id, limit) => ipcRenderer.invoke('similar:byId', { id, limit }),
  pickSampleFile: () => ipcRenderer.invoke('similar:pickFile'),
  similarByFile: (path, limit) => ipcRenderer.invoke('similar:byFile', { path, limit }),
  startDragMany: (ids) => ipcRenderer.send('drag:startMany', ids),
  exportCredits: (opts) => ipcRenderer.invoke('credits:export', opts || {}),

  // AI
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  directorChat: (messages, opts) => ipcRenderer.invoke('director:chat', { messages, opts }),
  onDirectorEvent: (cb) => ipcRenderer.on('director:event', (_e, d) => cb(d)),
  generateStatus: () => ipcRenderer.invoke('generate:status'),
  generateMusic: (spec) => ipcRenderer.invoke('generate:run', spec),
  onGenerateProgress: (cb) => ipcRenderer.on('generate:progress', (_e, d) => cb(d)),
  analyzeLibrary: () => ipcRenderer.invoke('analyze:run'),
  genres: () => ipcRenderer.invoke('lib:genres'),
  onAnalyzeProgress: (cb) => ipcRenderer.on('analyze:progress', (_e, d) => cb(d)),
  onAiReady: (cb) => ipcRenderer.on('ai:ready', () => cb()),
  remoteSearch: (provider, query, page) => ipcRenderer.invoke('remote:search', { provider, query, page }),
  resolveAudio: (id, fx) => ipcRenderer.invoke('audio:resolve', id, fx),
  peaks: (id) => ipcRenderer.invoke('audio:peaks', id),
  segments: (id) => ipcRenderer.invoke('audio:segments', id),
  startDrag: (id, selection) => ipcRenderer.send('drag:start', { id, selection }),
  reveal: (p) => ipcRenderer.invoke('reveal', p),

  // Collections
  listCollections: () => ipcRenderer.invoke('col:list'),
  createCollection: (name) => ipcRenderer.invoke('col:create', name),
  renameCollection: (id, name) => ipcRenderer.invoke('col:rename', { id, name }),
  deleteCollection: (id) => ipcRenderer.invoke('col:delete', id),
  addToCollection: (collectionId, soundId) => ipcRenderer.invoke('col:add', { collectionId, soundId }),
  removeFromCollection: (collectionId, soundId) => ipcRenderer.invoke('col:remove', { collectionId, soundId }),
  collectionsForSound: (soundId) => ipcRenderer.invoke('col:forSound', soundId),

  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_e, d) => cb(d)),
  onDragError: (cb) => ipcRenderer.on('drag:error', (_e, d) => cb(d)),
});
