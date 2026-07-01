import React, { useState } from 'react';

const fmtDur = (s) =>
  s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)}s`;

function shortLicense(l) {
  if (!l || l === 'local') return '';
  if (/apache/i.test(l)) return 'APACHE';
  if (/creativecommons|cc/i.test(l)) {
    if (/zero|cc0|publicdomain/i.test(l)) return 'CC0';
    const m = l.match(/licenses\/([a-z-]+)\//i);
    return m ? `CC ${m[1].toUpperCase()}` : 'CC';
  }
  return l.length > 8 ? l.slice(0, 8) : l;
}

const BADGE = { local: 'local', freesound: 'free', generate: 'gen' };

/**
 * One library row — fixed height for windowing. Layout adapts to kind: music rows
 * surface artist · genre and BPM; sfx rows surface tags and duration. The star and
 * the add-to-collection affordance are always reachable.
 */
export default function SoundRow({
  sound, height, selected, musicColumns, collections, onSelect, onToggleFav, onAddToCollection,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const s = sound;
  const isMusic = musicColumns && s.kind === 'music';

  const secondary = isMusic
    ? [s.artist, s.genre].filter(Boolean).join(' · ')
    : (s.tags || '').split(/\s+/).filter(Boolean).slice(0, 5).join(' · ');
  const metaNum = isMusic && s.bpm ? `${Math.round(s.bpm)} BPM` : fmtDur(s.duration);

  return (
    <div
      className={`row ${selected ? 'sel' : ''}`}
      style={{ height }}
      onClick={() => onSelect(s)}
    >
      <button
        className={`star ${s.favorite ? 'on' : ''}`}
        title={s.favorite ? 'Unfavorite' : 'Favorite'}
        onClick={(e) => { e.stopPropagation(); onToggleFav(s); }}
      >
        ★
      </button>
      <span className={`badge ${s.source}`}>{BADGE[s.source] || s.source}</span>
      <span className="row-name" title={s.name}>{s.name}</span>
      <span className="row-sub" title={secondary}>{secondary}</span>
      <span className="row-num">{metaNum}</span>
      <span className="row-lic">{shortLicense(s.license)}</span>
      <div className="row-actions">
        <button
          className="add-btn"
          title="Add to collection"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
        >
          ＋
        </button>
        {menuOpen && (
          <div className="add-menu" onClick={(e) => e.stopPropagation()}>
            {collections.length === 0 && <div className="add-empty">No collections yet</div>}
            {collections.map((c) => (
              <button
                key={c.id}
                className="add-item"
                onClick={() => { onAddToCollection(c.id, s); setMenuOpen(false); }}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
