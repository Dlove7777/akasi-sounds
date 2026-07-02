import React, { useState, useEffect, useRef } from 'react';

// Peaks cache shared across (re)mounts — virtualization constantly unmounts rows,
// so this keeps scrolling free of repeat IPC. null = known-unavailable (remote,
// not yet cached); undefined = not asked yet.
const peaksCache = new Map();
const peaksInflight = new Map();
async function getPeaks(sound) {
  if (sound.peaks) return sound.peaks; // arrived with the search row
  if (peaksCache.has(sound.id)) return peaksCache.get(sound.id);
  if (!peaksInflight.has(sound.id)) {
    peaksInflight.set(
      sound.id,
      (window.akasi.peaks ? window.akasi.peaks(sound.id) : Promise.resolve(null))
        .then((p) => { peaksCache.set(sound.id, p || null); peaksInflight.delete(sound.id); return p || null; })
        .catch(() => { peaksCache.set(sound.id, null); peaksInflight.delete(sound.id); return null; })
    );
  }
  return peaksInflight.get(sound.id);
}

function RowWave({ sound, selected }) {
  const ref = useRef(null);
  const [peaks, setPeaks] = useState(sound.peaks || peaksCache.get(sound.id));

  useEffect(() => {
    let alive = true;
    if (peaks === undefined) getPeaks(sound).then((p) => alive && setPeaks(p));
    return () => { alive = false; };
  }, [sound.id]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const { width: w, height: h } = c;
    ctx.clearRect(0, 0, w, h);
    if (!peaks || !peaks.length) {
      ctx.fillStyle = 'rgba(86,93,115,0.25)';
      ctx.fillRect(0, h / 2 - 0.5, w, 1);
      return;
    }
    const n = peaks.length, bw = w / n, mid = h / 2;
    ctx.fillStyle = selected ? '#4fd1c5' : '#39405a';
    for (let i = 0; i < n; i++) {
      const bh = Math.max(1, (peaks[i] / 255) * (h * 0.92));
      ctx.fillRect(i * bw, mid - bh / 2, Math.max(0.6, bw - 0.4), bh);
    }
  }, [peaks, selected]);

  return <canvas ref={ref} className="row-wave" width={200} height={26} />;
}

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
      <RowWave sound={s} selected={selected} />
      <span className="row-sub" title={secondary}>{secondary}</span>
      <span className="row-num">
        {metaNum}
        {s.use_count > 0 && <em className="row-uses" title={`Used ${s.use_count}×`}>×{s.use_count}</em>}
      </span>
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
