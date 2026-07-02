import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ResultsList from './components/ResultsList.jsx';
import Waveform from './components/Waveform.jsx';
import CheatSheet from './components/CheatSheet.jsx';

const AUDITION_DEBOUNCE = 120; // ms — avoid a fetch storm while arrow-scrubbing

export default function App() {
  const [scope, setScope] = useState('library');
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [remoteMode, setRemoteMode] = useState(false); // provider id | false
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [auditionSound, setAuditionSound] = useState(null);
  const [cueToken, setCueToken] = useState(0);
  const [fades, setFades] = useState({ fadeIn: 0, fadeOut: 0 });
  const [fx, setFx] = useState({ semi: 0, reverse: false, gainDb: 0 });
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('akasi.autoplay') !== '0');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [stats, setStats] = useState({ total: 0, favorites: 0, music: 0 });
  const [providers, setProviders] = useState([]);
  const [folders, setFolders] = useState([]);
  const [collections, setCollections] = useState([]);
  const [busy, setBusy] = useState(null);
  const isMock = window.akasi.__mock;
  const auditionTimer = useRef(null);

  const scopeOpts = useCallback(() => {
    if (scope === 'favorites') return { favoritesOnly: true };
    if (scope === 'music') return { kind: 'music' };
    if (scope === 'collection' && activeCollectionId) return { collectionId: activeCollectionId };
    return {};
  }, [scope, activeCollectionId]);

  const refresh = useCallback(async () => {
    if (remoteMode) return;
    setResults(await window.akasi.search(query, { ...scopeOpts(), limit: 2000 }));
  }, [remoteMode, query, scopeOpts]);

  useEffect(() => { refresh(); }, [refresh]);

  const loadMeta = useCallback(async () => {
    setStats(await window.akasi.stats());
    setCollections(await window.akasi.listCollections());
  }, []);

  useEffect(() => {
    (async () => {
      await loadMeta();
      setProviders(await window.akasi.providers());
      setFolders(await window.akasi.listFolders());
    })();
    window.akasi.onDragError?.((msg) => setBusy(`Drag failed: ${msg}`));
  }, [loadMeta]);

  // Debounced audition: selection highlights instantly; the player loads the sound
  // that's still selected after the debounce, so holding an arrow key doesn't fetch
  // every row it passes over.
  const cue = useCallback((sound) => {
    setSelectedId(sound.id);
    if (auditionTimer.current) clearTimeout(auditionTimer.current);
    auditionTimer.current = setTimeout(() => {
      setAuditionSound(sound);
      setFades({ fadeIn: 0, fadeOut: 0 });
      setFx({ semi: 0, reverse: false, gainDb: 0 }); // varispeed resets per file (Soundminer behavior)
      if (autoPlayRef.current) setCueToken((t) => t + 1); // auto-play only when the A toggle is on
    }, AUDITION_DEBOUNCE);
  }, []);
  const autoPlayRef = useRef(autoPlay);
  useEffect(() => {
    autoPlayRef.current = autoPlay;
    localStorage.setItem('akasi.autoplay', autoPlay ? '1' : '0');
  }, [autoPlay]);

  // Keyboard-first navigation across the (possibly huge) result set.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if (e.key === '?') { setSheetOpen((v) => !v); return; }
      if (e.key === 'Escape') { setSheetOpen(false); return; }
      if (e.key === 'a' || e.key === 'A') { setAutoPlay((v) => !v); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!results.length) return;
      e.preventDefault();
      const idx = results.findIndex((r) => r.id === selectedId);
      const next = e.key === 'ArrowDown'
        ? Math.min(results.length - 1, idx < 0 ? 0 : idx + 1)
        : Math.max(0, idx < 0 ? 0 : idx - 1);
      cue(results[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, selectedId, cue]);

  async function runRemote(provider) {
    if (!query.trim()) { setResults([]); return; }
    setBusy(`Searching ${provider}…`);
    const r = await window.akasi.remoteSearch(provider, query);
    setBusy(r.error || null);
    if (!r.error) { setResults(r.results); await loadMeta(); }
  }

  function onScope(s) { setRemoteMode(false); setScope(s); setActiveCollectionId(null); }
  function onCollection(id) { setRemoteMode(false); setScope('collection'); setActiveCollectionId(id); }
  function onRemote(id) { setRemoteMode(id); setResults([]); }

  function onSearchKey(e) {
    if (e.key === 'Enter' && remoteMode) { runRemote(remoteMode); return; }
    // Type a query → press ↓ to jump straight into auditioning (Soundly flow).
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault();
      e.target.blur();
      const idx = results.findIndex((r) => r.id === selectedId);
      cue(results[Math.min(results.length - 1, idx < 0 ? 0 : idx + 1)]);
      return;
    }
    if (e.key === 'Escape') e.target.blur();
  }

  async function addFolders() {
    setBusy('Scanning…');
    window.akasi.onScanProgress?.((p) => setBusy(`Scanning ${p.done}/${p.total}`));
    await window.akasi.addFolders();
    setBusy(null);
    setFolders(await window.akasi.listFolders());
    await loadMeta();
    refresh();
  }

  async function toggleFav(s) {
    await window.akasi.toggleFavorite(s.id);
    setResults((rs) => rs.map((r) => (r.id === s.id ? { ...r, favorite: r.favorite ? 0 : 1 } : r)));
    loadMeta();
    if (scope === 'favorites') refresh();
  }

  async function createCollection(name) {
    await window.akasi.createCollection(name);
    setCollections(await window.akasi.listCollections());
  }
  async function deleteCollection(id) {
    await window.akasi.deleteCollection(id);
    if (activeCollectionId === id) onScope('library');
    setCollections(await window.akasi.listCollections());
  }
  async function addToCollection(collectionId, s) {
    await window.akasi.addToCollection(collectionId, s.id);
    setCollections(await window.akasi.listCollections());
    setBusy('Added to collection');
    setTimeout(() => setBusy(null), 1200);
  }

  const musicColumns = scope === 'music';
  const placeholder = remoteMode
    ? `Search ${remoteMode} — press Enter…`
    : scope === 'music' ? 'Search music…'
    : scope === 'collection' ? 'Search this collection…'
    : 'Search your library…';

  return (
    <div className="app">
      <Sidebar
        scope={scope}
        activeCollectionId={activeCollectionId}
        onScope={onScope}
        onCollection={onCollection}
        collections={collections}
        onCreateCollection={createCollection}
        onDeleteCollection={deleteCollection}
        providers={providers}
        remoteMode={remoteMode}
        onRemote={onRemote}
        folders={folders}
        onAddFolders={addFolders}
        stats={stats}
        isMock={isMock}
      />

      <main className="main">
        <div className="searchbar">
          <span className="search-ico">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder={placeholder}
          />
          {remoteMode && <button className="go" onClick={() => runRemote(remoteMode)}>Search</button>}
          <span className="count">{results.length ? `${results.length.toLocaleString()} results` : ''}</span>
          {busy && <span className="busy">{busy}</span>}
        </div>

        {results.length === 0 ? (
          <div className="empty">
            {remoteMode
              ? `Type a query and press Enter to pull from ${remoteMode}.`
              : 'Nothing here — add a folder or search online.  ↑ / ↓ to audition · Space to play.'}
          </div>
        ) : (
          <ResultsList
            rows={results}
            selectedId={selectedId}
            resetKey={`${remoteMode}|${scope}|${activeCollectionId}|${query}`}
            musicColumns={musicColumns}
            collections={collections}
            onSelect={cue}
            onToggleFav={toggleFav}
            onAddToCollection={addToCollection}
          />
        )}

        <div className="dock">
          <Waveform sound={auditionSound} cueToken={cueToken} fades={fades} onFadesChange={setFades}
                    fx={fx} onFxChange={setFx}
                    autoPlay={autoPlay} onAutoPlayChange={setAutoPlay}
                    onOpenSheet={() => setSheetOpen(true)} />
        </div>
      </main>

      <CheatSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
