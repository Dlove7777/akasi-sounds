import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import thesaurus from './lib/thesaurus.js';
import './styles.css';

// When running in a plain browser (design preview) instead of Electron, `window.akasi`
// is absent. Provide a mock with a large synthetic library so virtualization,
// scopes, favorites, and collections can all be reviewed visually.
if (!window.akasi) {
  const SFX = ['Thunder Clap', 'Rain On Window', 'Footsteps Gravel', 'Door Slam', 'UI Whoosh', 'Glass Break',
    'Sword Draw', 'Car Engine Start', 'Keyboard Type', 'Wind Gust', 'Ocean Waves', 'Fire Crackle',
    'Camera Shutter', 'Coin Pickup', 'Laser Zap', 'Paper Rustle', 'Bell Ding', 'Crowd Cheer',
    'Heartbeat', 'Metal Impact', 'Water Drip', 'Explosion Distant', 'Cloth Movement', 'Clock Tick'];
  const SFX_TAGS = ['impact', 'ambience', 'foley', 'transition', 'nature', 'mechanical', 'ui', 'organic', 'cinematic', 'texture'];
  const GENRES = ['Cinematic', 'Lo-Fi', 'Ambient', 'Hip Hop', 'Orchestral', 'Electronic', 'Acoustic', 'Tension'];
  const ARTISTS = ['Akasi Studio', 'V. Mora', 'North Bloc', 'Kite & Ivy', 'Lowfield', 'The Meridian'];
  const LICENSES = ['CC0', 'CC BY 4.0', 'CC BY-NC 4.0', 'local'];

  // Deterministic synthetic waveform envelope (no RNG — stable across renders).
  const mkPeaks = (seed) => {
    const p = new Uint8Array(160);
    for (let i = 0; i < 160; i++) {
      const env = Math.sin((i / 160) * Math.PI); // swell
      const jitter = 0.55 + 0.45 * Math.abs(Math.sin(i * 0.7 + seed * 1.3));
      p[i] = Math.round(230 * env * jitter);
    }
    return p;
  };

  const demo = [];
  let id = 1;
  for (let i = 0; i < 900; i++) {
    const name = SFX[i % SFX.length];
    const tags = [SFX_TAGS[i % SFX_TAGS.length], SFX_TAGS[(i * 3) % SFX_TAGS.length], name.split(' ')[0].toLowerCase()].join(' ');
    const lic = LICENSES[i % LICENSES.length];
    demo.push({
      id: id++, source: i % 3 === 0 ? 'freesound' : 'local', kind: 'sfx',
      name: `${name.toLowerCase().replace(/ /g, '_')}_${String((i % 40) + 1).padStart(2, '0')}.wav`,
      tags, duration: +(0.3 + (i % 50) * 0.6).toFixed(1),
      license: lic, attribution: lic.startsWith('CC') ? `"${name}" by user (freesound.org)` : null,
      favorite: i % 17 === 0 ? 1 : 0,
      use_count: i % 11 === 0 ? (i % 5) + 1 : 0,
      last_used_at: i % 11 === 0 ? 1e12 + i * 1000 : null,
    });
  }
  for (let i = 0; i < 320; i++) {
    const genre = GENRES[i % GENRES.length];
    const artist = ARTISTS[i % ARTISTS.length];
    const lic = i % 4 === 0 ? 'CC BY 4.0' : 'local';
    demo.push({
      id: id++, source: i % 5 === 0 ? 'generate' : 'local', kind: 'music',
      name: `${genre} Bed ${String((i % 30) + 1).padStart(2, '0')}.wav`,
      tags: `${genre.toLowerCase()} ${artist.toLowerCase()} bed underscore loop`,
      artist, album: `${genre} Vol. ${(i % 4) + 1}`, genre, bpm: 70 + (i % 80), year: 2020 + (i % 6),
      duration: 30 + (i % 120), license: i % 5 === 0 ? 'ACE-Step 1.5 / Apache-2.0' : lic,
      attribution: i % 5 === 0 ? 'Generated · ACE-Step 1.5' : (lic.startsWith('CC') ? `"${genre} Bed" by ${artist}` : null),
      favorite: i % 23 === 0 ? 1 : 0,
    });
  }

  let collections = [
    { id: 1, name: 'Trailer Cut', created_at: Date.now() },
    { id: 2, name: 'Podcast Beds', created_at: Date.now() },
  ];
  const membership = { 1: new Set([1, 3, 5, 7]), 2: new Set([901, 905, 910]) };
  let cid = 3;

  // Thesaurus-expanded match, mirroring the real FTS behavior: AND across terms,
  // OR within a term's synonym group.
  const matches = (d, q) => {
    if (!q) return true;
    const hay = (d.name + ' ' + (d.tags || '') + ' ' + (d.artist || '') + ' ' + (d.genre || '')).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean)
      .every((term) => thesaurus.expand(term).some((syn) => hay.includes(syn)));
  };
  const filt = (q, o = {}) => {
    let out = demo.filter((d) =>
      (!o.favoritesOnly || d.favorite) &&
      (!o.recentOnly || d.last_used_at) &&
      (!o.source || d.source === o.source) &&
      (!o.kind || d.kind === o.kind) &&
      (!o.collectionId || (membership[o.collectionId] && membership[o.collectionId].has(d.id))) &&
      matches(d, q)
    );
    if (o.sort === 'duration') out = [...out].sort((a, b) => (a.duration || 9e9) - (b.duration || 9e9));
    else if (o.sort === 'used') out = [...out].sort((a, b) => (b.use_count || 0) - (a.use_count || 0));
    else if (o.recentOnly) out = [...out].sort((a, b) => (b.last_used_at || 0) - (a.last_used_at || 0));
    return out.slice(0, o.limit || 2000);
  };

  const vocab = [...new Set(demo.flatMap((d) => (d.name + ' ' + (d.tags || '')).toLowerCase().split(/[^a-z]+/)))]
    .filter((t) => t.length > 2);

  const listCollections = () => collections.map((c) => ({ ...c, count: (membership[c.id] || new Set()).size }));

  window.akasi = {
    __mock: true,
    search: async (q, o) => filt(q, o),
    stats: async () => ({
      total: demo.length,
      favorites: demo.filter((d) => d.favorite).length,
      music: demo.filter((d) => d.kind === 'music').length,
      recent: demo.filter((d) => d.last_used_at).length,
      bySource: [],
    }),
    toggleFavorite: async (sid) => { const d = demo.find((x) => x.id === sid); if (d) d.favorite = d.favorite ? 0 : 1; return 1; },
    updateMeta: async (sid, fields) => { const d = demo.find((x) => x.id === sid); if (d) Object.assign(d, fields); return 1; },
    listFolders: async () => [{ path: '/Users/you/SFX Library' }, { path: '/Users/you/Music/Beds' }],
    addFolders: async () => ({ added: [] }),
    providers: async () => [{ id: 'freesound', label: 'Freesound' }],
    suggest: async (prefix) => vocab.filter((t) => t.startsWith(prefix.toLowerCase())).slice(0, 8),
    remoteSearch: async (p, q) => ({ count: 0, results: filt(q, { source: p }) }),
    resolveAudio: async () => ({ path: '' }),
    peaks: async (sid) => mkPeaks(sid),
    segments: async (sid) => {
      const d = demo.find((x) => x.id === sid);
      if (!d || sid % 3 !== 0) return []; // every 3rd sound is a "variation pack"
      const dur = d.duration || 4;
      const n = 3 + (sid % 3);
      return Array.from({ length: n }, (_, i) => ({
        start: (i * dur) / n + 0.05,
        end: ((i + 1) * dur) / n - 0.08,
      }));
    },
    startDrag: () => {},
    reveal: async () => {},
    listCollections: async () => listCollections(),
    createCollection: async (name) => { const nid = cid++; collections.push({ id: nid, name, created_at: Date.now() }); membership[nid] = new Set(); return nid; },
    renameCollection: async () => 1,
    deleteCollection: async (delId) => { collections = collections.filter((c) => c.id !== delId); delete membership[delId]; return 1; },
    addToCollection: async (colId, sid) => { (membership[colId] = membership[colId] || new Set()).add(sid); return 1; },
    removeFromCollection: async (colId, sid) => { membership[colId]?.delete(sid); return 1; },
    collectionsForSound: async (sid) => Object.keys(membership).filter((k) => membership[k].has(sid)).map(Number),
    onScanProgress: () => {},
    onDragError: () => {},
  };
}

createRoot(document.getElementById('root')).render(<App />);
