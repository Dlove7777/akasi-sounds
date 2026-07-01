import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// When running in a plain browser (design preview) instead of Electron, `window.akasi`
// is absent. Provide a small mock so the UI renders and can be reviewed visually.
if (!window.akasi) {
  const demo = [
    { id: 1, source: 'freesound', name: 'Thunder Clap Distant.wav', tags: 'thunder storm weather rumble', duration: 4.6, license: 'CC BY 4.0', attribution: '"Thunder" by user (freesound.org)', favorite: 1 },
    { id: 2, source: 'local', name: 'footsteps_gravel_run.wav', tags: 'footsteps gravel run foley', duration: 2.1, license: 'local', path: '/lib/foot.wav', favorite: 0 },
    { id: 3, source: 'freesound', name: 'UI Whoosh Transition.mp3', tags: 'whoosh ui transition swish', duration: 0.8, license: 'CC0', attribution: 'CC0', favorite: 0 },
    { id: 4, source: 'local', name: 'door_slam_heavy.wav', tags: 'door slam impact wood', duration: 1.3, license: 'local', path: '/lib/door.wav', favorite: 0 },
    { id: 5, source: 'freesound', name: 'Rain On Window Loop.wav', tags: 'rain window ambience loop', duration: 30.0, license: 'CC BY 4.0', attribution: '"Rain" by user (freesound.org)', favorite: 1 },
  ];
  const filt = (q, o = {}) => demo.filter((d) => (!o.favoritesOnly || d.favorite) && (!o.source || d.source === o.source) && (!q || (d.name + ' ' + d.tags).toLowerCase().includes(q.toLowerCase())));
  window.akasi = {
    __mock: true,
    search: async (q, o) => filt(q, o),
    stats: async () => ({ total: demo.length, favorites: 2, bySource: [{ source: 'local', c: 2 }, { source: 'freesound', c: 3 }] }),
    toggleFavorite: async () => 1,
    listFolders: async () => [{ path: '/Users/you/SFX Library' }],
    addFolders: async () => ({ added: [] }),
    providers: async () => [{ id: 'freesound', label: 'Freesound' }],
    remoteSearch: async (p, q) => ({ count: 0, results: filt(q, { source: p }) }),
    resolveAudio: async () => ({ path: '' }),
    startDrag: () => {},
    reveal: async () => {},
    onScanProgress: () => {},
    onDragError: () => {},
  };
}

createRoot(document.getElementById('root')).render(<App />);
