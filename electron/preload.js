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
  startDragMany: (ids) => ipcRenderer.send('drag:startMany', ids),
  exportCredits: (opts) => ipcRenderer.invoke('credits:export', opts || {}),
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
