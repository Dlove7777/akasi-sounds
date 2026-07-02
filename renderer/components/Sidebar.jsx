import React, { useState } from 'react';

const SCOPES = [
  { id: 'library', label: 'Library' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'recent', label: 'Recent' },
  { id: 'music', label: 'Music' },
];

/**
 * Left rail — library scopes, dynamic collections (with counts + create), online
 * providers, and indexed folders. The active scope drives the results query in App.
 */
export default function Sidebar({
  scope, activeCollectionId, onScope, onCollection,
  collections, onCreateCollection, onDeleteCollection,
  providers, remoteMode, onRemote,
  folders, onAddFolders, stats, isMock,
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    const n = name.trim();
    if (n) onCreateCollection(n);
    setName('');
    setCreating(false);
  };

  return (
    <aside className="sidebar">
      <div className="brand"><span className="brand-dot" />Akasi Sounds</div>

      <div className="side-section">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            className={`side-item ${!remoteMode && scope === s.id ? 'active' : ''}`}
            onClick={() => onScope(s.id)}
          >
            <span>{s.label}</span>
            {s.id === 'favorites' && stats.favorites > 0 && <span className="side-count">{stats.favorites}</span>}
            {s.id === 'recent' && stats.recent > 0 && <span className="side-count">{stats.recent}</span>}
            {s.id === 'music' && stats.music > 0 && <span className="side-count">{stats.music}</span>}
          </button>
        ))}
      </div>

      <div className="side-label">
        <span>Collections</span>
        <button className="side-plus" title="New collection" onClick={() => setCreating(true)}>＋</button>
      </div>
      <div className="side-section">
        {creating && (
          <input
            className="side-input"
            autoFocus
            placeholder="Collection name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setCreating(false); }}
            onBlur={submit}
          />
        )}
        {collections.length === 0 && !creating && <div className="side-hint">No collections</div>}
        {collections.map((c) => (
          <button
            key={c.id}
            className={`side-item ${!remoteMode && scope === 'collection' && activeCollectionId === c.id ? 'active' : ''}`}
            onClick={() => onCollection(c.id)}
            onDoubleClick={() => onDeleteCollection(c.id)}
            title="Double-click to delete"
          >
            <span className="side-collection-name">{c.name}</span>
            <span className="side-count">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="side-label"><span>Online</span></div>
      <div className="side-section">
        {providers.length === 0 && <div className="side-hint">No provider key set</div>}
        {providers.map((p) => (
          <button
            key={p.id}
            className={`side-item ${remoteMode === p.id ? 'active' : ''}`}
            onClick={() => onRemote(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="side-label"><span>Folders</span></div>
      <div className="side-section folders">
        {folders.map((f) => (
          <div key={f.path} className="folder" title={f.path}>{f.path.split('/').pop()}</div>
        ))}
        <button className="side-add" onClick={onAddFolders}>＋ Add folder</button>
      </div>

      <div className="side-foot">
        {stats.total.toLocaleString()} sounds · {stats.favorites} ★
        {isMock && <div className="mock-badge">preview · mock data</div>}
      </div>
    </aside>
  );
}
