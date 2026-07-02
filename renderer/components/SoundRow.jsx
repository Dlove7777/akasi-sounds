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

// Shared hover-scrub player — one <audio> for the whole list. ⌥-hovering a row's
// waveform previews from that exact point (BaseHead-style) without touching the
// dock selection. The dock pauses itself via the akasi:scrub-start event.
let scrubEl = null;
const scrubUrl = new Map(); // id → url | null
function scrubAudio() {
  if (!scrubEl) { scrubEl = new Audio(); scrubEl.preload = 'auto'; }
  return scrubEl;
}
async function scrubTo(sound, frac) {
  window.dispatchEvent(new Event('akasi:scrub-start')); // dock ducks immediately
  let url = scrubUrl.get(sound.id);
  if (url === undefined) {
    try {
      const r = await window.akasi.resolveAudio(sound.id);
      url = r?.url || (r?.path ? `file://${r.path}` : null);
    } catch { url = null; }
    scrubUrl.set(sound.id, url);
  }
  if (!url) return;
  const a = scrubAudio();
  if (a._sid !== sound.id) { a.src = url; a._sid = sound.id; }
  const seek = () => {
    const d = a.duration || sound.duration || 0;
    if (d) a.currentTime = Math.min(d - 0.02, frac * d);
    a.play().catch(() => {});
  };
  if (a.readyState >= 1) seek();
  else a.onloadedmetadata = seek;
}
function scrubStop() {
  if (scrubEl) scrubEl.pause();
}

function RowWave({ sound, selected }) {
  const ref = useRef(null);
  const [peaks, setPeaks] = useState(sound.peaks || peaksCache.get(sound.id));
  const [scrubFrac, setScrubFrac] = useState(null);
  const lastScrub = useRef(0);

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
    } else {
      const n = peaks.length, bw = w / n, mid = h / 2;
      ctx.fillStyle = selected ? '#4fd1c5' : '#39405a';
      for (let i = 0; i < n; i++) {
        const bh = Math.max(1, (peaks[i] / 255) * (h * 0.92));
        ctx.fillRect(i * bw, mid - bh / 2, Math.max(0.6, bw - 0.4), bh);
      }
    }
    if (scrubFrac != null) {
      ctx.strokeStyle = '#f0b429';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(scrubFrac * w, 0);
      ctx.lineTo(scrubFrac * w, h);
      ctx.stroke();
    }
  }, [peaks, selected, scrubFrac]);

  function onMove(e) {
    if (!e.altKey) { if (scrubFrac != null) { setScrubFrac(null); scrubStop(); } return; }
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrubFrac(frac);
    const now = performance.now();
    if (now - lastScrub.current > 90) { lastScrub.current = now; scrubTo(sound, frac); }
  }
  function onLeave() {
    if (scrubFrac != null) { setScrubFrac(null); scrubStop(); }
  }

  return (
    <canvas
      ref={ref} className="row-wave" width={200} height={26}
      title="⌥-hover to scrub-preview"
      onMouseMove={onMove} onMouseLeave={onLeave} onMouseOut={onLeave}
      onClick={(e) => { if (e.altKey) e.stopPropagation(); }}
    />
  );
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
/** Anchored inline editor — rename/retag/reclassify without leaving the list. */
function MetaEditor({ sound, onSave, onClose }) {
  const [f, setF] = useState({
    name: sound.name || '',
    tags: sound.tags || '',
    kind: sound.kind || 'sfx',
    artist: sound.artist || '',
    genre: sound.genre || '',
    bpm: sound.bpm || '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    onSave({
      name: f.name.trim() || sound.name,
      tags: f.tags.trim(),
      kind: f.kind,
      artist: f.artist.trim(),
      genre: f.genre.trim(),
      bpm: f.bpm === '' ? '' : +f.bpm || '',
    });
    onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
    if (e.key === 'Escape') onClose();
    e.stopPropagation();
  };
  return (
    <div className="meta-editor" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
      <label>Name<input autoFocus value={f.name} onChange={set('name')} /></label>
      <label>Tags<input value={f.tags} onChange={set('tags')} placeholder="space separated" /></label>
      <div className="meta-row">
        <label className="meta-kind">Kind
          <div className="kind-toggle">
            {['sfx', 'music'].map((k) => (
              <button key={k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{k}</button>
            ))}
          </div>
        </label>
        {f.kind === 'music' && (
          <>
            <label>Artist<input value={f.artist} onChange={set('artist')} /></label>
            <label>Genre<input value={f.genre} onChange={set('genre')} /></label>
            <label className="meta-bpm">BPM<input type="number" value={f.bpm} onChange={set('bpm')} /></label>
          </>
        )}
      </div>
      <div className="meta-actions">
        <button className="meta-save" onClick={save}>Save ⏎</button>
        <button className="meta-cancel" onClick={onClose}>esc</button>
      </div>
    </div>
  );
}

export default function SoundRow({
  sound, height, selected, isChecked, musicColumns, collections, onSelect, onToggleFav, onAddToCollection, onEdit,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const s = sound;
  const isMusic = musicColumns && s.kind === 'music';

  const secondary = isMusic
    ? [s.artist, s.genre].filter(Boolean).join(' · ')
    : (s.tags || '').split(/\s+/).filter(Boolean).slice(0, 5).join(' · ');
  const metaNum = isMusic && s.bpm ? `${Math.round(s.bpm)} BPM` : fmtDur(s.duration);

  return (
    <div
      className={`row ${selected ? 'sel' : ''} ${isChecked ? 'checked' : ''}`}
      style={{ height }}
      onClick={(e) => onSelect(s, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
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
          className="add-btn edit-btn"
          title="Edit metadata"
          onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); setMenuOpen(false); }}
        >
          ✎
        </button>
        <button
          className="add-btn"
          title="Add to collection"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); setEditing(false); }}
        >
          ＋
        </button>
        {editing && (
          <MetaEditor
            sound={s}
            onClose={() => setEditing(false)}
            onSave={(fields) => onEdit(s, fields)}
          />
        )}
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
