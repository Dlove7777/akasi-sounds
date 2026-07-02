import React, { useEffect, useRef, useState } from 'react';
import { computeSpectrogram } from '../lib/spectrogram.mjs';

// Brand color ramp for the spectrogram: dark → teal → amber → white-hot.
function specColor(v) {
  const t = v / 255;
  if (t < 0.45) { const k = t / 0.45; return [Math.round(10 + 30 * k), Math.round(11 + 90 * k), Math.round(16 + 80 * k), Math.round(255 * (0.25 + 0.75 * k))]; }
  if (t < 0.8) { const k = (t - 0.45) / 0.35; return [Math.round(40 + 200 * k * 0.85), Math.round(101 + 108 * k * 0.65), Math.round(96 + 0 * k), 255]; } // teal → amber
  const k = (t - 0.8) / 0.2;
  return [Math.round(240 + 15 * k), Math.round(180 + 60 * k), Math.round(41 + 160 * k), 255];
}

/** Render a computed spectrogram to an offscreen canvas (bin 0 at the bottom). */
function specToCanvas(spec) {
  const c = document.createElement('canvas');
  c.width = spec.cols; c.height = spec.bins;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(spec.cols, spec.bins);
  for (let col = 0; col < spec.cols; col++) {
    for (let b = 0; b < spec.bins; b++) {
      const [r, g, bl, a] = specColor(spec.data[col * spec.bins + b]);
      const y = spec.bins - 1 - b; // low freq at the bottom
      const p = (y * spec.cols + col) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = bl; img.data[p + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Waveform + transport for the currently-selected sound.
 * - Decodes the file (file:// path from main) via Web Audio, draws peaks on canvas.
 * - Drag across the canvas to set a crop selection (start/end); the selection is what
 *   gets rendered on drag-out. Space = play/pause, click = seek.
 * - Fade in/out are numeric (seconds) and baked in by ffmpeg at render time.
 */
// One shared AudioContext for gain routing (an <audio> element can only ever be
// wired to a single MediaElementSource, so we create the graph once per element).
let sharedCtx = null;
function getCtx() {
  if (!sharedCtx) {
    try { sharedCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no WebAudio */ }
  }
  return sharedCtx;
}

export default function Waveform({
  sound, cueToken, fades, onFadesChange, fx, onFxChange,
  autoPlay, onAutoPlayChange, onOpenSheet,
}) {
  const canvasRef = useRef(null);
  const audioRef = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [duration, setDuration] = useState(sound?.duration || 0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // seconds
  const [sel, setSel] = useState(null); // {start,end} seconds
  const [src, setSrc] = useState('');
  const dragRef = useRef(null);
  const wantPlayRef = useRef(false);
  const gainRef = useRef(null);
  const wiredRef = useRef(false);
  const [loopOn, setLoopOn] = useState(() => localStorage.getItem('akasi.loop') === '1');
  const [muted, setMuted] = useState(false);
  const [segs, setSegs] = useState(null);
  const [activeSeg, setActiveSeg] = useState(-1);
  const [specOn, setSpecOn] = useState(() => localStorage.getItem('akasi.spec') === '1');
  const [specReady, setSpecReady] = useState(false); // bumps draw when heatmap lands
  const chanRef = useRef(null); // decoded channel 0, kept for spectrogram
  const specRef = useRef(null); // offscreen heatmap canvas for the current sound

  useEffect(() => { localStorage.setItem('akasi.spec', specOn ? '1' : '0'); }, [specOn]);

  // Compute the heatmap lazily — only when the view is on and samples are decoded.
  useEffect(() => {
    if (!specOn || specRef.current || !chanRef.current) return;
    const t = setTimeout(() => {
      const spec = computeSpectrogram(chanRef.current, { fftSize: 512, cols: 440, bins: 96 });
      if (spec) { specRef.current = specToCanvas(spec); setSpecReady((v) => !v); }
    }, 10); // let the toggle paint first
    return () => clearTimeout(t);
  }, [specOn, sound?.id, peaks]);

  // Segments (variation packs). Skipped when reversed — chip times describe the
  // forward timeline and would lie against a reversed preview.
  useEffect(() => {
    let alive = true;
    setSegs(null); setActiveSeg(-1);
    if (!sound || fx?.reverse || !window.akasi.segments) return;
    window.akasi.segments(sound.id).then((s) => {
      if (alive && Array.isArray(s) && s.length > 1) setSegs(s);
    }).catch(() => {});
    return () => { alive = false; };
  }, [sound?.id, fx?.reverse]);

  function selectSegment(i) {
    const seg = segs?.[i];
    if (!seg) return;
    setActiveSeg(i);
    setSel({ start: seg.start, end: seg.end });
    const a = audioRef.current;
    if (a) { a.currentTime = seg.start; a.play().then(() => setPlaying(true)).catch(() => {}); }
  }

  // Loop + mute are listening-mode preferences — they survive sound changes.
  useEffect(() => {
    const a = audioRef.current;
    if (a) { a.loop = loopOn; a.muted = muted; }
    localStorage.setItem('akasi.loop', loopOn ? '1' : '0');
  }, [loopOn, muted, src]);

  // A new cue (arrow-key or click audition) requests auto-play once the file loads.
  useEffect(() => { if (cueToken) wantPlayRef.current = true; }, [cueToken]);

  // Live varispeed: pitch + tempo together, like a Soundminer varispeed fader.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = Math.pow(2, (fx?.semi || 0) / 12);
    a.preservesPitch = false;
    a.webkitPreservesPitch = false;
  }, [fx?.semi, src]);

  // Live gain via a GainNode (element volume caps at 1.0 — no boost without WebAudio).
  useEffect(() => {
    const a = audioRef.current;
    const ctx = getCtx();
    if (!a || !ctx) return;
    if (!wiredRef.current) {
      try {
        const node = ctx.createMediaElementSource(a);
        const g = ctx.createGain();
        node.connect(g).connect(ctx.destination);
        gainRef.current = g;
        wiredRef.current = true;
      } catch { /* leave default routing */ }
    }
    if (gainRef.current) gainRef.current.gain.value = Math.pow(10, (fx?.gainDb || 0) / 20);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, [fx?.gainDb, src]);

  // Resolve + decode when the sound (or reverse state) changes. Reverse serves an
  // ffmpeg-reversed temp file so the audition matches what the drag will bake.
  useEffect(() => {
    let cancelled = false;
    const resume = playing || wantPlayRef.current;
    setPeaks(null); setSel(null); setPos(0); setPlaying(false);
    chanRef.current = null; specRef.current = null; // new audio → new heatmap
    if (!sound) return;
    if (resume) wantPlayRef.current = true; // keep playing across a reverse flip
    (async () => {
      const resolved = await window.akasi.resolveAudio(sound.id, { reverse: !!fx?.reverse });
      // Prefer the privileged media URL from main; fall back to a file URL.
      const url = resolved?.url || (resolved?.path ? `file://${resolved.path}` : '');
      if (cancelled || !url) { setSrc(''); return; }
      setSrc(url);
      try {
        const buf = await fetch(url).then((r) => r.arrayBuffer());
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        setDuration(audio.duration);
        chanRef.current = audio.getChannelData(0); // retained for the spectrogram
        setPeaks(computePeaks(audio, 900));
        ctx.close();
      } catch { setDuration(sound.duration || 0); /* transport still works if decode fails */ }
    })();
    return () => { cancelled = true; };
  }, [sound?.id, fx?.reverse]);

  // Draw
  useEffect(() => {
    draw(canvasRef.current, peaks, pos, duration, sel, fades, segs, specOn ? specRef.current : null);
  }, [peaks, pos, duration, sel, fades, segs, specOn, specReady]);

  useEffect(() => {
    const onKey = (e) => {
      if (!sound) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const a = audioRef.current;
        if (a) { e.preventDefault(); a.currentTime = Math.max(0, Math.min(duration, a.currentTime + (e.key === 'ArrowRight' ? 1 : -1))); }
        return;
      }
      if (e.key === 'l' || e.key === 'L') { setLoopOn((v) => !v); return; }
      if (e.key === 'm' || e.key === 'M') { setMuted((v) => !v); return; }
      if (e.key === 's' || e.key === 'S') { setSpecOn((v) => !v); return; }
      if (segs && /^[1-9]$/.test(e.key)) { selectSegment(+e.key - 1); return; }
      // Functional updates — rapid key runs must not clobber each other.
      if (e.key === 'r' || e.key === 'R') { onFxChange((f) => ({ ...f, reverse: !f.reverse })); return; }
      if (e.key === '[') { onFxChange((f) => ({ ...f, semi: Math.max(-12, (f.semi || 0) - 1) })); return; }
      if (e.key === ']') { onFxChange((f) => ({ ...f, semi: Math.min(12, (f.semi || 0) + 1) })); return; }
      if (e.key === '0') { onFxChange({ semi: 0, reverse: false, gainDb: 0 }); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sound, playing, fx, onFxChange, duration, segs]);

  // Selection-aware transport: with a crop/segment active, stop at its end —
  // or cycle back to its start when LOOP is on.
  function onTime(e) {
    const t = e.target.currentTime;
    setPos(t);
    if (sel && t >= sel.end - 0.015) {
      if (loopOn) { e.target.currentTime = sel.start; }
      else { e.target.pause(); setPlaying(false); }
    }
  }

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => {}); setPlaying(true); } else { a.pause(); setPlaying(false); }
  }

  // Auto-play when a cue asked for it and the audio is ready.
  function onCanPlay() {
    if (!wantPlayRef.current) return;
    wantPlayRef.current = false;
    const a = audioRef.current;
    if (a) a.play().then(() => setPlaying(true)).catch(() => {});
  }

  function xToTime(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));
  }
  function onDown(e) { dragRef.current = xToTime(e); setActiveSeg(-1); setSel({ start: dragRef.current, end: dragRef.current }); }
  function onMove(e) {
    if (dragRef.current == null) return;
    const t = xToTime(e);
    setSel({ start: Math.min(dragRef.current, t), end: Math.max(dragRef.current, t) });
  }
  function onUp(e) {
    if (dragRef.current == null) return;
    const t = xToTime(e);
    if (Math.abs(t - dragRef.current) < 0.03) { // treat as a seek click
      setSel(null);
      if (audioRef.current) audioRef.current.currentTime = t;
      setPos(t);
    }
    dragRef.current = null;
  }

  function beginDrag(e) {
    e.preventDefault();
    const fxOut = {
      speed: Math.pow(2, (fx?.semi || 0) / 12),
      reverse: !!fx?.reverse,
      gainDb: fx?.gainDb || 0,
    };
    window.akasi.startDrag(sound.id, { ...(sel || {}), ...fades, ...fxOut });
  }

  if (!sound) return <div className="wf-empty">Select a sound to preview</div>;

  const selLabel = sel ? `${fmt(sel.start)}–${fmt(sel.end)} (${fmt(sel.end - sel.start)})` : `full ${fmt(duration)}`;

  return (
    <div className="wf">
      <audio ref={audioRef} src={src} onTimeUpdate={onTime}
             onCanPlay={onCanPlay}
             onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.target.duration || duration)} />
      <button className={`wf-play ${playing ? 'on' : ''}`} onClick={toggle} title="Play / pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="wf-main">
        <div className="wf-top">
          <span className="wf-name" title={sound.name}>{sound.name}</span>
          <span className="wf-pills">
            <button className={`pill ${loopOn ? 'on' : ''}`} title="Loop playback (L)"
              onClick={() => setLoopOn((v) => !v)}>LOOP</button>
            <button className={`pill ${autoPlay ? 'on' : ''}`} title="Auto-play on select (A)"
              onClick={() => onAutoPlayChange((v) => !v)}>AUTO</button>
            <button className={`pill ${muted ? 'warn' : ''}`} title="Mute (M)"
              onClick={() => setMuted((v) => !v)}>{muted ? 'MUTED' : 'MUTE'}</button>
            <button className={`pill ${specOn ? 'on' : ''}`} title="Spectrogram view (S)"
              onClick={() => setSpecOn((v) => !v)}>SPEC</button>
            <button className="pill ghost" title="Keyboard shortcuts (?)" onClick={onOpenSheet}>?</button>
          </span>
          <span className="wf-sel">{selLabel}</span>
        </div>
        {segs && (
          <div className="wf-segs">
            <span className="wf-segs-label">{segs.length} takes</span>
            {segs.slice(0, 24).map((g, i) => (
              <button key={i} className={`seg-chip ${activeSeg === i ? 'on' : ''}`}
                title={`${g.start.toFixed(2)}–${g.end.toFixed(2)}s (key ${i + 1})`}
                onClick={() => selectSegment(i)}>{i + 1}</button>
            ))}
          </div>
        )}
        <canvas
          ref={canvasRef} className="wf-canvas" width={900} height={96}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        />
        <div className="wf-controls">
          <label>Fade in <input type="number" min="0" step="0.1" value={fades.fadeIn}
            onChange={(e) => onFadesChange({ ...fades, fadeIn: +e.target.value })} /> s</label>
          <label>Fade out <input type="number" min="0" step="0.1" value={fades.fadeOut}
            onChange={(e) => onFadesChange({ ...fades, fadeOut: +e.target.value })} /> s</label>
          <span className="wf-divider" />
          <label className="wf-fx" title="Varispeed — pitch + speed together ( [ / ] keys )">
            Pitch
            <input type="range" min="-12" max="12" step="1" value={fx.semi}
              onChange={(e) => onFxChange({ ...fx, semi: +e.target.value })} />
            <span className={`wf-fx-val ${fx.semi !== 0 ? 'hot' : ''}`}>{fx.semi > 0 ? `+${fx.semi}` : fx.semi} st</span>
          </label>
          <label className="wf-fx" title="Output gain (baked into the drag)">
            Gain
            <input type="range" min="-24" max="12" step="1" value={fx.gainDb}
              onChange={(e) => onFxChange({ ...fx, gainDb: +e.target.value })} />
            <span className={`wf-fx-val ${fx.gainDb !== 0 ? 'hot' : ''}`}>{fx.gainDb > 0 ? `+${fx.gainDb}` : fx.gainDb} dB</span>
          </label>
          <button className={`wf-rev ${fx.reverse ? 'on' : ''}`} title="Reverse (R)"
            onClick={() => onFxChange({ ...fx, reverse: !fx.reverse })}>◀ REV</button>
          {(fx.semi !== 0 || fx.gainDb !== 0 || fx.reverse) && (
            <button className="wf-clear" title="Reset FX (0)"
              onClick={() => onFxChange({ semi: 0, reverse: false, gainDb: 0 })}>reset</button>
          )}
          {sel && <button className="wf-clear" onClick={() => { setSel(null); setActiveSeg(-1); }}>clear crop</button>}
        </div>
      </div>
      <div className="wf-drag" draggable onDragStart={beginDrag} title="Drag into your timeline">
        <span className="wf-drag-ico">⇥</span>
        <span>Drag to<br/>timeline</span>
      </div>
    </div>
  );
}

function computePeaks(audioBuffer, buckets) {
  const ch = audioBuffer.getChannelData(0);
  const size = Math.floor(ch.length / buckets);
  const peaks = new Float32Array(buckets);
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    for (let j = 0; j < size; j++) { const v = Math.abs(ch[i * size + j] || 0); if (v > max) max = v; }
    peaks[i] = max;
  }
  return peaks;
}

function draw(canvas, peaks, pos, duration, sel, fades, segs, specCanvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;

  // spectrogram heatmap replaces the bars; overlays still draw on top
  if (specCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(specCanvas, 0, 0, w, h);
  }

  // segment boundary ticks
  if (segs && duration) {
    ctx.strokeStyle = 'rgba(127,134,156,0.35)';
    ctx.setLineDash([3, 4]);
    for (const g of segs) {
      for (const t of [g.start, g.end]) {
        if (t <= 0.01 || t >= duration - 0.01) continue;
        const x = (t / duration) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  // selection band
  if (sel && duration) {
    const x0 = (sel.start / duration) * w, x1 = (sel.end / duration) * w;
    ctx.fillStyle = 'rgba(79,209,197,0.14)';
    ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.strokeStyle = 'rgba(79,209,197,0.6)';
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();
  }

  // bars (waveform view only)
  if (peaks && !specCanvas) {
    const n = peaks.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * duration;
      const played = duration && t <= pos;
      ctx.fillStyle = played ? '#4fd1c5' : '#3a4050';
      const bh = Math.max(1, peaks[i] * (h * 0.86));
      ctx.fillRect(i * bw, mid - bh / 2, Math.max(1, bw - 0.6), bh);
    }
  } else if (!specCanvas) {
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(0, mid - 1, w, 2);
  }

  // playhead
  if (duration) {
    const px = (pos / duration) * w;
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
}

const fmt = (s) => (s == null || isNaN(s) ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`);
