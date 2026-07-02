import React, { useEffect, useRef, useState } from 'react';

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

export default function Waveform({ sound, cueToken, fades, onFadesChange, fx, onFxChange }) {
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
        setPeaks(computePeaks(audio, 900));
        ctx.close();
      } catch { setDuration(sound.duration || 0); /* transport still works if decode fails */ }
    })();
    return () => { cancelled = true; };
  }, [sound?.id, fx?.reverse]);

  // Draw
  useEffect(() => { draw(canvasRef.current, peaks, pos, duration, sel, fades); }, [peaks, pos, duration, sel, fades]);

  useEffect(() => {
    const onKey = (e) => {
      if (!sound) return;
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
      if (typing) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
      // Functional updates — rapid key runs must not clobber each other.
      if (e.key === 'r' || e.key === 'R') { onFxChange((f) => ({ ...f, reverse: !f.reverse })); return; }
      if (e.key === '[') { onFxChange((f) => ({ ...f, semi: Math.max(-12, (f.semi || 0) - 1) })); return; }
      if (e.key === ']') { onFxChange((f) => ({ ...f, semi: Math.min(12, (f.semi || 0) + 1) })); return; }
      if (e.key === '0') { onFxChange({ semi: 0, reverse: false, gainDb: 0 }); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sound, playing, fx, onFxChange]);

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
  function onDown(e) { dragRef.current = xToTime(e); setSel({ start: dragRef.current, end: dragRef.current }); }
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
      <audio ref={audioRef} src={src} onTimeUpdate={(e) => setPos(e.target.currentTime)}
             onCanPlay={onCanPlay}
             onEnded={() => setPlaying(false)} onLoadedMetadata={(e) => setDuration(e.target.duration || duration)} />
      <button className={`wf-play ${playing ? 'on' : ''}`} onClick={toggle} title="Play / pause (Space)">
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="wf-main">
        <div className="wf-top">
          <span className="wf-name" title={sound.name}>{sound.name}</span>
          <span className="wf-sel">{selLabel}</span>
        </div>
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
          {sel && <button className="wf-clear" onClick={() => setSel(null)}>clear crop</button>}
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

function draw(canvas, peaks, pos, duration, sel, fades) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const mid = h / 2;

  // selection band
  if (sel && duration) {
    const x0 = (sel.start / duration) * w, x1 = (sel.end / duration) * w;
    ctx.fillStyle = 'rgba(79,209,197,0.14)';
    ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.strokeStyle = 'rgba(79,209,197,0.6)';
    ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();
  }

  // bars
  if (peaks) {
    const n = peaks.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * duration;
      const played = duration && t <= pos;
      ctx.fillStyle = played ? '#4fd1c5' : '#3a4050';
      const bh = Math.max(1, peaks[i] * (h * 0.86));
      ctx.fillRect(i * bw, mid - bh / 2, Math.max(1, bw - 0.6), bh);
    }
  } else {
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
