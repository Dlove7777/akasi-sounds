import React, { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar.jsx';
import ResultsList from './components/ResultsList.jsx';
import Waveform from './components/Waveform.jsx';
import CheatSheet from './components/CheatSheet.jsx';
import thesaurus from './lib/thesaurus.js';

const RECENT_KEY = 'akasi.recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };

const TABS_KEY = 'akasi.tabs';
const DEFAULT_TAB_STATE = { scope: 'library', activeCollectionId: null, remoteMode: false, query: '', sort: 'relevance' };
const loadTabs = () => {
  try {
    const t = JSON.parse(localStorage.getItem(TABS_KEY));
    if (t?.tabs?.length) return t;
  } catch { /* fresh */ }
  return { tabs: [{ id: 1, state: { ...DEFAULT_TAB_STATE } }], active: 0 };
};

const AUDITION_DEBOUNCE = 120; // ms — avoid a fetch storm while arrow-scrubbing

export default function App() {
  const [scope, setScope] = useState('library');
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [remoteMode, setRemoteMode] = useState(false); // provider id | false
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [similarOf, setSimilarOf] = useState(null); // seed sound when in "Find Similar" mode
  const [selectedId, setSelectedId] = useState(null);
  const [auditionSound, setAuditionSound] = useState(null);
  const [cueToken, setCueToken] = useState(0);
  const [fades, setFades] = useState({ fadeIn: 0, fadeOut: 0 });
  const [fx, setFx] = useState({ semi: 0, reverse: false, gainDb: 0 });
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('akasi.autoplay') !== '0');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sugs, setSugs] = useState([]);
  const [searchFocus, setSearchFocus] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [checked, setChecked] = useState(() => new Set()); // multi-selection (ids)
  const anchorRef = useRef(-1); // shift-range anchor (index in results)
  const [tabState] = useState(loadTabs); // initial snapshot only
  const [tabs, setTabs] = useState(tabState.tabs);
  const [activeTab, setActiveTab] = useState(Math.min(tabState.active, tabState.tabs.length - 1));
  const [aiReady, setAiReady] = useState(false);
  const [aiInstalled, setAiInstalled] = useState(false);
  const [genreList, setGenreList] = useState([]);
  const [filters, setFilters] = useState({ dur: null, bpm: null, genre: null, vocals: null });
  const [autoAnalyze, setAutoAnalyze] = useState(() => localStorage.getItem('akasi.autoAnalyze') !== '0');
  useEffect(() => { localStorage.setItem('akasi.autoAnalyze', autoAnalyze ? '1' : '0'); }, [autoAnalyze]);
  const [stats, setStats] = useState({ total: 0, favorites: 0, music: 0 });
  const [providers, setProviders] = useState([]);
  const [folders, setFolders] = useState([]);
  const [collections, setCollections] = useState([]);
  const [busy, setBusy] = useState(null);
  const isMock = window.akasi.__mock;
  const auditionTimer = useRef(null);

  const [sort, setSort] = useState('relevance');

  // ---- Locked search tabs: each tab snapshots the full search context ----
  const applyTabState = useCallback((s) => {
    setScope(s.scope ?? 'library');
    setActiveCollectionId(s.activeCollectionId ?? null);
    setRemoteMode(s.remoteMode ?? false);
    setQuery(s.query ?? '');
    setSort(s.sort ?? 'relevance');
  }, []);

  // Restore the active tab's context once on boot.
  useEffect(() => { applyTabState(tabs[activeTab]?.state || DEFAULT_TAB_STATE); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Any context change is captured into the active tab ("locked" behavior) + persisted.
  useEffect(() => {
    setTabs((ts) => {
      const next = ts.map((t, i) =>
        i === activeTab ? { ...t, state: { scope, activeCollectionId, remoteMode, query, sort } } : t);
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: next, active: activeTab }));
      return next;
    });
  }, [scope, activeCollectionId, remoteMode, query, sort, activeTab]);

  function switchTab(i) {
    if (i === activeTab || !tabs[i]) return;
    setActiveTab(i);
    applyTabState(tabs[i].state);
    setChecked(new Set());
  }
  function addTab() {
    const id = Math.max(...tabs.map((t) => t.id)) + 1;
    const next = [...tabs, { id, state: { ...DEFAULT_TAB_STATE } }];
    setTabs(next);
    setActiveTab(next.length - 1);
    applyTabState(DEFAULT_TAB_STATE);
  }
  function closeTab(i, e) {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const next = tabs.filter((_, x) => x !== i);
    const newActive = i < activeTab ? activeTab - 1 : Math.min(activeTab, next.length - 1);
    setTabs(next);
    setActiveTab(newActive);
    if (i === activeTab) applyTabState(next[newActive].state);
  }
  const tabLabel = (t) => {
    const s = t.state || {};
    let base = s.remoteMode ? String(s.remoteMode)
      : s.scope === 'collection' ? (collections.find((c) => c.id === s.activeCollectionId)?.name || 'Collection')
      : s.scope === 'favorites' ? 'Favorites'
      : s.scope === 'recent' ? 'Recent'
      : s.scope === 'music' ? 'Music' : 'Library';
    if (s.query?.trim()) base += ` · ${s.query.trim().slice(0, 14)}`;
    return base;
  };

  const DUR_BUCKETS = { short: { durMax: 2 }, medium: { durMin: 2, durMax: 15 }, long: { durMin: 15 } };
  const BPM_BUCKETS = { slow: { bpmMax: 90 }, mid: { bpmMin: 90, bpmMax: 121 }, fast: { bpmMin: 121 } };

  const scopeOpts = useCallback(() => {
    const base =
      scope === 'favorites' ? { favoritesOnly: true }
      : scope === 'recent' ? { recentOnly: true }
      : scope === 'music' ? { kind: 'music' }
      : scope === 'collection' && activeCollectionId ? { collectionId: activeCollectionId }
      : {};
    return {
      ...base,
      ...(filters.dur ? DUR_BUCKETS[filters.dur] : {}),
      ...(filters.bpm ? BPM_BUCKETS[filters.bpm] : {}),
      ...(filters.genre ? { genre: filters.genre } : {}),
      ...(filters.vocals != null ? { vocals: filters.vocals } : {}),
    };
  }, [scope, activeCollectionId, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    if (remoteMode || similarOf) return; // "Find Similar" owns the result set until cleared
    setResults(await window.akasi.search(query, { ...scopeOpts(), sort, limit: 2000 }));
  }, [remoteMode, similarOf, query, scopeOpts, sort]);

  useEffect(() => { refresh(); }, [refresh]);

  // Any change to the search context exits "Find Similar" mode (then refresh restores
  // the normal result set). Entering similar mode changes none of these, so it sticks.
  useEffect(() => { setSimilarOf(null); }, [scope, activeCollectionId, query, sort, filters]);

  const enterSimilar = useCallback((seed, rows) => {
    setSimilarOf(seed);
    setResults(rows || []);
    setSelectedId(null);
    setChecked(new Set());
  }, []);

  const findSimilar = useCallback(async (s) => {
    if (!window.akasi.findSimilar) return;
    setBusy(`Finding sounds like ${s.name}…`);
    const r = await window.akasi.findSimilar(s.id, 60);
    if (r?.error) { setBusy(r.error); setTimeout(() => setBusy(null), 2600); return; }
    enterSimilar(s, r.results);
    setBusy(null);
  }, [enterSimilar]);

  // Match any external audio file (picker or OS drag-in) against the library by sound.
  const matchSampleByPath = useCallback(async (path) => {
    if (!window.akasi.similarByFile || !path) return;
    const base = String(path).split(/[\\/]/).pop();
    setBusy(`Analyzing ${base}…`);
    const r = await window.akasi.similarByFile(path, 60);
    if (r?.error) { setBusy(r.error); setTimeout(() => setBusy(null), 3000); return; }
    enterSimilar({ id: `file:${path}`, name: base, _file: true }, r.results);
    setBusy(null);
  }, [enterSimilar]);

  const matchSample = useCallback(async () => {
    if (!window.akasi.pickSampleFile) return;
    const picked = await window.akasi.pickSampleFile();
    if (!picked || picked.canceled || !picked.path) return;
    matchSampleByPath(picked.path);
  }, [matchSampleByPath]);

  // OS drag-in of an external audio file → match-by-sound.
  const onSampleDrop = useCallback((e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f || !f.path) return;
    e.preventDefault();
    if (/\.(wav|mp3|aiff?|flac|m4a|ogg|opus|wma)$/i.test(f.path)) matchSampleByPath(f.path);
  }, [matchSampleByPath]);

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
    // AI availability + live analyze progress
    window.akasi.aiStatus?.().then((s) => { setAiInstalled(!!s?.installed); setAiReady(!!s?.ready); });
    window.akasi.onAiReady?.(() => { setAiReady(true); setBusy('AI search ready'); setTimeout(() => setBusy(null), 1500); });
    window.akasi.onAnalyzeProgress?.((p) => setBusy(`Analyzing ${p.done}/${p.total}${p.current ? ` · ${p.current.slice(0, 28)}` : ''}`));
    window.akasi.genres?.().then((g) => setGenreList(g || []));
  }, [loadMeta]);

  async function runAnalyze() {
    setBusy('Starting analysis…');
    const r = await window.akasi.analyzeLibrary();
    setBusy(r?.error ? r.error : `Analyzed ${r.done} sounds`);
    setTimeout(() => setBusy(null), 2500);
    window.akasi.genres?.().then((g) => setGenreList(g || []));
    refresh();
    loadMeta();
  }

  // Row click router: plain = audition (clears multi-selection), ⌘/Ctrl = toggle
  // into the checked set, ⇧ = range from the last anchor.
  const onRowSelect = useCallback((sound, mods = {}) => {
    const idx = results.findIndex((r) => r.id === sound.id);
    if (mods.meta) {
      anchorRef.current = idx;
      setChecked((c) => {
        const n = new Set(c);
        n.has(sound.id) ? n.delete(sound.id) : n.add(sound.id);
        return n;
      });
      return;
    }
    if (mods.shift && anchorRef.current >= 0) {
      const [a, b] = [anchorRef.current, idx].sort((x, y) => x - y);
      setChecked((c) => {
        const n = new Set(c);
        for (let i = a; i <= b; i++) n.add(results[i].id);
        return n;
      });
      return;
    }
    anchorRef.current = idx;
    setChecked(new Set());
    cue(sound);
  }, [results]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (e.key === 'Escape') { setSheetOpen(false); setChecked(new Set()); return; }
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setChecked(new Set(results.map((r) => r.id)));
        return;
      }
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

  // Autocomplete on the last token; synonym hint from the thesaurus.
  useEffect(() => {
    const last = query.trim().split(/\s+/).pop() || '';
    if (!searchFocus || last.length < 2 || !window.akasi.suggest) { setSugs([]); return; }
    let alive = true;
    window.akasi.suggest(last).then((s) => alive && setSugs((s || []).filter((t) => t !== last)));
    return () => { alive = false; };
  }, [query, searchFocus]);

  const synHint = query.trim().split(/\s+/).filter(Boolean)
    .flatMap((t) => thesaurus.synonymsOf(t)).slice(0, 6);

  // Commit a "kept" query to recent searches after a beat of no typing.
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 3 || !results.length) return;
    const t = setTimeout(() => {
      setRecent((r) => {
        const next = [q, ...r.filter((x) => x !== q)].slice(0, 8);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        return next;
      });
    }, 1800);
    return () => clearTimeout(t);
  }, [query, results.length]);

  function acceptSuggestion(term) {
    const parts = query.trim().split(/\s+/);
    parts[parts.length ? parts.length - 1 : 0] = term;
    setQuery(parts.join(' ') + ' ');
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
    if (e.key === 'Tab' && sugs.length) { e.preventDefault(); acceptSuggestion(sugs[0]); return; }
    if (e.key === 'Escape') e.target.blur();
  }

  async function addFolders() {
    setBusy('Scanning…');
    window.akasi.onScanProgress?.((p) => setBusy(`Scanning ${p.done}/${p.total}`));
    const r = await window.akasi.addFolders();
    setBusy(null);
    setFolders(await window.akasi.listFolders());
    await loadMeta();
    refresh();
    // Auto-enrich newly-scanned files in the background (incremental — only new ones).
    if (r && !r.canceled && autoAnalyze && aiInstalled) runAnalyze();
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
  async function editMeta(s, fields) {
    await window.akasi.updateMeta(s.id, fields);
    setResults((rs) => rs.map((r) => (r.id === s.id ? { ...r, ...fields, bpm: fields.bpm === '' ? null : fields.bpm } : r)));
    loadMeta(); // kind flips move counts between scopes
    setBusy('Saved');
    setTimeout(() => setBusy(null), 900);
  }

  const checkedIds = [...checked];

  async function batchFavorite() {
    await window.akasi.setFavoriteMany(checkedIds, true);
    setResults((rs) => rs.map((r) => (checked.has(r.id) ? { ...r, favorite: 1 } : r)));
    loadMeta();
  }

  async function batchAddToCollection(collectionId) {
    await window.akasi.addManyToCollection(collectionId, checkedIds);
    setCollections(await window.akasi.listCollections());
    setBusy(`Added ${checkedIds.length} to collection`);
    setTimeout(() => setBusy(null), 1200);
  }

  function batchDragStart(e) {
    e.preventDefault();
    window.akasi.startDragMany?.(checkedIds);
  }

  const creditsScope = scope === 'collection' && activeCollectionId
    ? { collectionId: activeCollectionId, title: `Audio credits — ${collections.find((c) => c.id === activeCollectionId)?.name || 'collection'}` }
    : scope === 'recent' ? { recentOnly: true, title: 'Audio credits — used sounds' } : null;

  async function exportCredits(clientSafe) {
    if (!creditsScope || !window.akasi.exportCredits) return;
    const r = await window.akasi.exportCredits({ ...creditsScope, clientSafe });
    if (r?.error) setBusy(r.error);
    else if (r?.path) setBusy(`Exported ${r.count} credits${r.flagged ? ` · ${r.flagged} NC ${r.excluded ? 'excluded' : 'FLAGGED'}` : ''}`);
    if (r && !r.canceled) setTimeout(() => setBusy(null), 2500);
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

      <main className="main"
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
        onDrop={onSampleDrop}>
        <div className="tabs">
          {tabs.map((t, i) => (
            <button key={t.id} className={`tab ${i === activeTab ? 'active' : ''}`} onClick={() => switchTab(i)}
              title="Locked search tab — keeps its scope, query and sort">
              <span className="tab-label">{tabLabel(t)}</span>
              {tabs.length > 1 && <span className="tab-x" onClick={(e) => closeTab(i, e)}>×</span>}
            </button>
          ))}
          <button className="tab-add" title="New search tab" onClick={addTab}>＋</button>
        </div>
        <div className="searchbar">
          <span className="search-ico">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSearchFocus(true); }}
            onKeyDown={onSearchKey}
            onFocus={() => setSearchFocus(true)}
            onClick={() => setSearchFocus(true)}
            onBlur={() => setTimeout(() => setSearchFocus(false), 140)}
            placeholder={placeholder}
          />
          {remoteMode && <button className="go" onClick={() => runRemote(remoteMode)}>Search</button>}
          {!remoteMode && (
            <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)} title="Sort results">
              <option value="relevance">Relevance</option>
              <option value="newest">Newest</option>
              <option value="duration">Duration</option>
              <option value="used">Most used</option>
              <option value="bpm">BPM</option>
            </select>
          )}
          {aiReady && !remoteMode && <span className="ai-badge" title="Semantic AI search active — describe the sound you want">AI</span>}
          {aiInstalled && !remoteMode && (
            <span className="analyze-group">
              <button className="credits-btn" title="Analyze library — detect BPM, key, genre, vocals + build the AI search index"
                onClick={runAnalyze}>⚡ Analyze</button>
              <button className={`auto-toggle ${autoAnalyze ? 'on' : ''}`}
                title={autoAnalyze ? 'Auto-analyze new folders on import — ON' : 'Auto-analyze new folders on import — OFF'}
                onClick={() => setAutoAnalyze((v) => !v)}>auto</button>
            </span>
          )}
          {aiInstalled && !remoteMode && (
            <button className="credits-btn" title="Match a sample — pick or drag in any audio file to find similar-sounding library files (AI)"
              onClick={matchSample}>⇪ Match sample</button>
          )}
          {creditsScope && results.length > 0 && (
            <button
              className="credits-btn"
              title="Export an attribution manifest (.md + .csv) for this scope — ⌥-click for client-safe (excludes CC-BY-NC)"
              onClick={(e) => exportCredits(e.altKey)}
            >
              ⎙ Credits
            </button>
          )}
          <span className="count">{results.length ? `${results.length.toLocaleString()} results` : ''}</span>
          {busy && <span className="busy">{busy}</span>}

          {searchFocus && (sugs.length > 0 || (!query.trim() && recent.length > 0)) && (
            <div className="sug-panel">
              {!query.trim() && recent.length > 0 && (
                <>
                  <div className="sug-title">Recent</div>
                  {recent.map((r) => (
                    <button key={r} className="sug-item" onMouseDown={(e) => { e.preventDefault(); setQuery(r); }}>
                      <span className="sug-ico">↩</span>{r}
                    </button>
                  ))}
                </>
              )}
              {sugs.length > 0 && (
                <>
                  <div className="sug-title">Suggestions <span className="sug-hint">Tab completes</span></div>
                  {sugs.map((s) => (
                    <button key={s} className="sug-item" onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(s); }}>
                      <span className="sug-ico">⌕</span>{s}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {query.trim() && synHint.length > 0 && (
            <span className="syn-hint" title="Thesaurus-expanded search">≈ {synHint.join(' · ')}</span>
          )}
        </div>

        {!remoteMode && (
          <div className="filterbar">
            <span className="fb-group">
              {[['dur', 'short', '<2s'], ['dur', 'medium', '2–15s'], ['dur', 'long', '15s+']].map(([k, v, label]) => (
                <button key={v} className={`fb-chip ${filters[k] === v ? 'on' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v }))}>{label}</button>
              ))}
            </span>
            <span className="fb-sep" />
            <span className="fb-group">
              {[['bpm', 'slow', '<90'], ['bpm', 'mid', '90–120'], ['bpm', 'fast', '120+']].map(([k, v, label]) => (
                <button key={v} className={`fb-chip ${filters[k] === v ? 'on' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, [k]: f[k] === v ? null : v }))}>{label} BPM</button>
              ))}
            </span>
            <span className="fb-sep" />
            <button className={`fb-chip ${filters.vocals === 0 ? 'on' : ''}`}
              title="Instrumental only (AI-detected)"
              onClick={() => setFilters((f) => ({ ...f, vocals: f.vocals === 0 ? null : 0 }))}>Instrumental</button>
            <button className={`fb-chip ${filters.vocals === 1 ? 'on' : ''}`}
              onClick={() => setFilters((f) => ({ ...f, vocals: f.vocals === 1 ? null : 1 }))}>Vocals</button>
            {genreList.length > 0 && (
              <select className="fb-select" value={filters.genre || ''}
                onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value || null }))}>
                <option value="">All genres</option>
                {genreList.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {(filters.dur || filters.bpm || filters.genre || filters.vocals != null) && (
              <button className="fb-clear" onClick={() => setFilters({ dur: null, bpm: null, genre: null, vocals: null })}>clear</button>
            )}
          </div>
        )}

        {similarOf && (
          <div className="similar-banner">
            <span className="sim-ico">≋</span>
            <span>Sounds similar to <b>{similarOf.name}</b></span>
            <span className="sim-count">{results.length} match{results.length === 1 ? '' : 'es'}</span>
            <button className="sim-clear" onClick={() => setSimilarOf(null)} title="Back to search">✕ clear</button>
          </div>
        )}

        {results.length === 0 ? (
          <div className="empty">
            {similarOf
              ? 'No similar sounds found — try analyzing more of your library.'
              : remoteMode
              ? `Type a query and press Enter to pull from ${remoteMode}.`
              : 'Nothing here — add a folder or search online.  ↑ / ↓ to audition · Space to play.'}
          </div>
        ) : (
          <ResultsList
            rows={results}
            selectedId={selectedId}
            checked={checked}
            resetKey={`${remoteMode}|${scope}|${activeCollectionId}|${query}|${similarOf?.id ?? ''}`}
            musicColumns={musicColumns}
            collections={collections}
            onSelect={onRowSelect}
            onToggleFav={toggleFav}
            onAddToCollection={addToCollection}
            onEdit={editMeta}
            onFindSimilar={!remoteMode ? findSimilar : undefined}
          />
        )}

        {checked.size > 1 && (
          <div className="batch-bar">
            <span className="batch-count">{checked.size} selected</span>
            <button className="batch-btn" onClick={batchFavorite}>★ Favorite all</button>
            <div className="batch-col">
              <select
                className="batch-select"
                defaultValue=""
                onChange={(e) => { if (e.target.value) { batchAddToCollection(+e.target.value); e.target.value = ''; } }}
              >
                <option value="" disabled>＋ Add to collection…</option>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="batch-drag" draggable onDragStart={batchDragStart} title="Drag all selected into your timeline">
              ⇥ Drag {checked.size} files
            </div>
            <button className="batch-clear" onClick={() => setChecked(new Set())}>esc</button>
          </div>
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
