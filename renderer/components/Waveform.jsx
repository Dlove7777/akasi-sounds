import React, { useEffect, useRef, useState } from 'react';

/**
 * Waveform + transport for the currently-selected sound.
 * - Decodes the file (file:// path from main) via Web Audio, draws peaks on canvas.
 * - Drag across the canvas to set a crop selection (start/end); the selection is what
 *   gets rendered on drag-out. Space = play/pause, click = seek.
 * - Fade in/out are numeric (seconds) and baked in by ffmpeg at render time.
 */
export default function Waveform({ sound, cueToken, fades, onFadesChange }) {
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

  // A new cue (arrow-key or click audition) requests auto-play once the file loads.
  useEffect(() => { if (cueToken) wantPlayRef.current = true; }, [cueToken]);

  // Resolve + decode when the sound changes.
  useEffect(() => {
    let cancelled = false;
    setPeaks(null); setSel(null); setPos(0); setPlaying(false);
    if (!sound) return;
    (async () => {
      const resolved = await window.akasi.resolveAudio(sound.id);
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
  }, [sound?.id]);

  // Draw
  useEffect(() => { draw(canvasRef.current, peaks, pos, duration, sel, fades); }, [peaks, pos, duration, sel, fades]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' && sound) { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sound, playing]);

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
    window.akasi.startDrag(sound.id, sel ? { ...sel, ...fades } : { ...fades });
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
