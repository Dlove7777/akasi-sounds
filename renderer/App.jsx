import React, { useEffect, useState, useCallback } from 'react';
import Waveform from './components/Waveform.jsx';

const SCOPES = [
  { id: 'library', label: 'Library', filter: {} },
  { id: 'favorites', label: 'Favorites', filter: { favoritesOnly: true } },
  { id: 'local', label: 'My Folders', filter: { source: 'local' } },
];

export default function App() {
  const [scope, setScope] = useState('library');
  const [remoteMode, setRemoteMode] = useState(false); // searching Freesound instead of local index
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [fades, setFades] = useState({ fadeIn: 0, fadeOut: 0 });
  const [stats, setStats] = useState({ total: 0, favorites: 0 });
  const [providers, setProviders] = useState([]);
  const [folders, setFolders] = useState([]);
  const [busy, setBusy] = useState(null);
  const isMock = window.akasi.__mock;

  const refresh = useCallback(async () => {
    if (remoteMode) return; // remote handled by its own effect
    const scopeDef = SCOPES.find((s) => s.id === scope) || SCOPES[0];
    setResults(await window.akasi.search(query, scopeDef.filter));
  }, [scope, query, remoteMode]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    (async () => {
      setStats(await window.akasi.stats());
      setProviders(await window.akasi.providers());
      setFolders(await window.akasi.listFolders());
    })();
    window.akasi.onDragError((msg) => setBusy(`Drag failed: ${msg}`));
  }, []);

  async function runRemote() {
    if (!query.trim()) return;
    setBusy('Searching Freesound…');
    const r = await window.akasi.remoteSearch('freesound', query);
    setBusy(null);
    if (r.error) return setBusy(r.error);
    setResults(r.results);
    setStats(await window.akasi.stats());
  }

  async function onSearchKey(e) {
    if (e.key === 'Enter' && remoteMode) runRemote();
  }

  async function addFolders() {
    setBusy('Scanning…');
    window.akasi.onScanProgress((p) => setBusy(`Scanning ${p.done}/${p.total}`));
    await window.akasi.addFolders();
    setBusy(null);
    setFolders(await window.akasi.listFolders());
    setStats(await window.akasi.stats());
    refresh();
  }

  async function fav(s, e) {
    e.stopPropagation();
    await window.akasi.toggleFavorite(s.id);
    setResults((rs) => rs.map((r) => (r.id === s.id ? { ...r, favorite: r.favorite ? 0 : 1 } : r)));
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-dot" />Akasi Sounds</div>

        <div className="side-section">
          {SCOPES.map((s) => (
            <button key={s.id} className={`side-item ${!remoteMode && scope === s.id ? 'active' : ''}`}
              onClick={() => { setRemoteMode(false); setScope(s.id); }}>{s.label}</button>
          ))}
        </div>

        <div className="side-label">Online</div>
        <div className="side-section">
          {providers.length === 0 && <div className="side-hint">No provider key set</div>}
          {providers.map((p) => (
            <button key={p.id} className={`side-item ${remoteMode ? 'active' : ''}`}
              onClick={() => { setRemoteMode(true); setResults([]); }}>{p.label}</button>
          ))}
        </div>

        <div className="side-label">Folders</div>
        <div className="side-section folders">
          {folders.map((f) => (
            <div key={f.path} className="folder" title={f.path}>{f.path.split('/').pop()}</div>
          ))}
          <button className="side-add" onClick={addFolders}>+ Add folder</button>
        </div>

        <div className="side-foot">
          {stats.total.toLocaleString()} sounds · {stats.favorites} ★
          {isMock && <div className="mock-badge">preview (mock data)</div>}
        </div>
      </aside>

      <main className="main">
        <div className="searchbar">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKey}
            placeholder={remoteMode ? 'Search Freesound — press Enter…' : 'Search your library…'} />
          {remoteMode && <button className="go" onClick={runRemote}>Search</button>}
          {busy && <span className="busy">{busy}</span>}
        </div>

        <div className="results">
          {results.length === 0 && (
            <div className="empty">
              {remoteMode ? 'Type a query and press Enter to pull from Freesound.' : 'Nothing here yet — add a folder or search Freesound.'}
            </div>
          )}
          {results.map((s) => (
            <div key={s.id} className={`row ${selected?.id === s.id ? 'sel' : ''}`}
              onClick={() => { setSelected(s); setFades({ fadeIn: 0, fadeOut: 0 }); }}>
              <button className={`star ${s.favorite ? 'on' : ''}`} onClick={(e) => fav(s, e)}>★</button>
              <span className={`badge ${s.source}`}>{s.source === 'local' ? 'local' : s.source === 'freesound' ? 'free' : s.source}</span>
              <span className="row-name">{s.name}</span>
              <span className="row-tags">{(s.tags || '').split(/\s+/).slice(0, 4).join(' · ')}</span>
              <span className="row-dur">{fmtDur(s.duration)}</span>
              <span className="row-lic">{shortLicense(s.license)}</span>
            </div>
          ))}
        </div>

        <div className="dock">
          <Waveform sound={selected} fades={fades} onFadesChange={setFades} />
        </div>
      </main>
    </div>
  );
}

const fmtDur = (s) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)}s`);
function shortLicense(l) {
  if (!l) return '';
  if (l === 'local') return '';
  if (/creativecommons|cc/i.test(l)) {
    if (/zero|cc0|publicdomain/i.test(l)) return 'CC0';
    const m = l.match(/licenses\/([a-z-]+)\//i);
    return m ? `CC ${m[1].toUpperCase()}` : 'CC';
  }
  return l;
}
