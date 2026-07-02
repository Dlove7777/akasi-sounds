import React from 'react';

const GROUPS = [
  {
    title: 'Browse & audition',
    keys: [
      ['↑ / ↓', 'Move selection + audition'],
      ['Space', 'Play / pause'],
      ['← / →', 'Seek ±1s'],
      ['L', 'Loop playback'],
      ['A', 'Auto-play on select'],
      ['M', 'Mute'],
      ['S', 'Spectrogram view'],
    ],
  },
  {
    title: 'Shape the sound (baked into drag)',
    keys: [
      ['[ / ]', 'Varispeed pitch ∓1 semitone'],
      ['R', 'Reverse'],
      ['0', 'Reset all FX'],
      ['1–9', 'Audition segment (variation takes)'],
      ['drag on waveform', 'Crop selection'],
      ['drag corner inward', 'Fade in / out'],
    ],
  },
  {
    title: 'Everything else',
    keys: [
      ['★ click', 'Favorite'],
      ['＋ on a row', 'Add to collection'],
      ['⌘ click / ⇧ click', 'Multi-select rows'],
      ['⌘A', 'Select all results'],
      ['Esc', 'Clear selection'],
      ['?', 'Toggle this sheet'],
    ],
  },
];

/** `?` overlay — the Soundly cheat sheet is a PDF; ours lives in the app. */
export default function CheatSheet({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span>Keyboard shortcuts</span>
          <button className="sheet-x" onClick={onClose}>esc</button>
        </div>
        <div className="sheet-cols">
          {GROUPS.map((g) => (
            <div key={g.title} className="sheet-group">
              <div className="sheet-title">{g.title}</div>
              {g.keys.map(([k, desc]) => (
                <div key={k} className="sheet-row">
                  <kbd>{k}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
