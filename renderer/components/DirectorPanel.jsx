import React, { useState, useEffect, useRef, useCallback } from 'react';

// Compact candidate row — auditionable (click) + native-draggable to the timeline,
// exactly like the library rows. `picked` highlights files the cue sheet named.
function DirectorRow({ row, picked, onAudition }) {
  return (
    <div
      className={`dir-row ${picked ? 'picked' : ''}`}
      draggable
      onDragStart={() => window.akasi.startDrag?.(row.id)}
      onClick={() => onAudition?.(row)}
      title="Click to audition · drag into your timeline"
    >
      <span className={`badge ${row.source}`}>{row.kind === 'music' ? 'mus' : 'sfx'}</span>
      <span className="dir-row-name">{row.name}</span>
      <span className="dir-row-meta">
        {row.kind === 'music' && row.bpm ? `${Math.round(row.bpm)} · ` : ''}
        {row.genre || row.ai_genre || (row.tags || '').split(/\s+/).slice(0, 2).join(' ')}
      </span>
      <span className="dir-row-drag" title="Drag to timeline">⇥</span>
    </div>
  );
}

/**
 * Music Director — a right slide-out chat. The OpenRouter brain drives a tool loop
 * over the REAL library; every candidate it pulls lands here as a live, auditionable,
 * draggable row (never invented text). The cue sheet is the model's ranking of the pool.
 */
export default function DirectorPanel({ open, onClose, onAudition, available }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [pool, setPool] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(null);
  const [mode, setMode] = useState('grounded');
  const logRef = useRef(null);

  // Live tool/pool events stream in while the loop runs (registered once).
  useEffect(() => {
    if (!window.akasi.onDirectorEvent) return;
    window.akasi.onDirectorEvent((evt) => {
      if (evt.type === 'pool') setPool(evt.rows || []);
      else if (evt.type === 'tool') setActivity(`${evt.name}(${evt.args?.query ? `"${String(evt.args.query).slice(0, 40)}"` : ''})`);
    });
  }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs, busy]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    const history = [...msgs, { role: 'user', content: text }];
    setMsgs(history);
    setInput('');
    setBusy(true);
    setPool([]);
    setActivity('thinking…');
    const r = await window.akasi.directorChat(history, { mode });
    if (r?.error) setMsgs([...history, { role: 'assistant', content: `⚠️ ${r.error}` }]);
    else {
      setMsgs([...history, { role: 'assistant', content: r.text || '(no answer)' }]);
      setPool(r.pool || []);
    }
    setBusy(false);
    setActivity(null);
  }, [input, busy, msgs, mode]);

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    e.stopPropagation();
  };

  // Files named in the latest cue sheet get the "picked" highlight.
  const lastAnswer = [...msgs].reverse().find((m) => m.role === 'assistant')?.content || '';
  const isPicked = (name) => name && lastAnswer.includes(name);

  if (!open) return null;
  return (
    <aside className="director-panel">
      <header className="dir-head">
        <span className="dir-title">🎬 Music Director</span>
        <div className="dir-mode" title="Grounded = one model searches + judges. Triad = 2 retrievers + a judge.">
          {['grounded', 'triad'].map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} disabled={busy}>{m}</button>
          ))}
        </div>
        <button className="dir-close" onClick={onClose} title="Close">✕</button>
      </header>

      <div className="dir-log" ref={logRef}>
        {msgs.length === 0 && (
          <div className="dir-hint">
            {available === false
              ? 'Set OPENROUTER_API_KEY in ~/.secrets.env to use the Director.'
              : 'Describe the cue you need — e.g. “a tense instrumental bed under 90 BPM for a promo”. I’ll pull real files from your library.'}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`dir-msg ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="dir-msg assistant busy">{activity || 'working…'}</div>}
      </div>

      {pool.length > 0 && (
        <div className="dir-pool">
          <div className="dir-pool-title">Candidates <span>{pool.length} · drag to timeline</span></div>
          <div className="dir-pool-rows">
            {pool.map((row) => (
              <DirectorRow key={row.id} row={row} picked={isPicked(row.name)} onAudition={onAudition} />
            ))}
          </div>
        </div>
      )}

      <div className="dir-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask the Music Director…"
          rows={2}
          disabled={busy}
        />
        <button className="dir-send" onClick={send} disabled={busy || !input.trim()}>Send ⏎</button>
      </div>
    </aside>
  );
}
