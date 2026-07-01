'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('akasi', {
  search: (query, opts) => ipcRenderer.invoke('lib:search', { query, opts }),
  stats: () => ipcRenderer.invoke('lib:stats'),
  toggleFavorite: (id) => ipcRenderer.invoke('lib:favorite', id),
  listFolders: () => ipcRenderer.invoke('lib:folders'),
  addFolders: () => ipcRenderer.invoke('folders:add'),
  providers: () => ipcRenderer.invoke('providers:list'),
  remoteSearch: (provider, query, page) => ipcRenderer.invoke('remote:search', { provider, query, page }),
  resolveAudio: (id) => ipcRenderer.invoke('audio:resolve', id),
  startDrag: (id, selection) => ipcRenderer.send('drag:start', { id, selection }),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_e, d) => cb(d)),
  onDragError: (cb) => ipcRenderer.on('drag:error', (_e, d) => cb(d)),
});
