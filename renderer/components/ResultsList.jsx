import React, { useRef, useState, useEffect, useCallback } from 'react';
import SoundRow from './SoundRow.jsx';

const ROW_H = 40; // fixed row height enables cheap windowing
const OVERSCAN = 8;

/**
 * Windowed results list — renders only the rows in view (+overscan), so it stays
 * smooth at thousands of rows. Fixed row height keeps the math trivial and scroll
 * jank-free. Selection is index-based so arrow-key audition can drive it from App.
 */
export default function ResultsList({
  rows, selectedId, checked, resetKey, onSelect, onToggleFav, onAddToCollection, onEdit, musicColumns, collections,
}) {
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);

  // A new query/scope resets the scroll to the top so the window doesn't start
  // past the end of a now-shorter result set (which would render zero rows).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row visible when selection is driven by the keyboard.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || selectedId == null) return;
    const idx = rows.findIndex((r) => r.id === selectedId);
    if (idx < 0) return;
    const top = idx * ROW_H;
    const bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selectedId, rows]);

  const onScroll = useCallback((e) => setScrollTop(e.currentTarget.scrollTop), []);

  const total = rows.length;
  // Fall back to the viewport height if the container hasn't measured yet (first
  // paint / layout races), so a tall window is never left with blank space below.
  const effectiveH = height > 0 ? height : (typeof window !== 'undefined' ? window.innerHeight : 800);
  const visibleCount = Math.ceil(effectiveH / ROW_H) + OVERSCAN * 2;
  // Clamp against stale scroll positions so `start` can never exceed the list.
  const maxScroll = Math.max(0, total * ROW_H - effectiveH);
  const clampedTop = Math.min(scrollTop, maxScroll);
  const start = Math.max(0, Math.floor(clampedTop / ROW_H) - OVERSCAN);
  const end = Math.min(total, start + visibleCount);
  const slice = rows.slice(start, end);

  return (
    <div className="results" ref={scrollRef} onScroll={onScroll}>
      <div className="results-pad" style={{ height: total * ROW_H }}>
        <div className="results-window" style={{ transform: `translateY(${start * ROW_H}px)` }}>
          {slice.map((s) => (
            <SoundRow
              key={s.id}
              sound={s}
              height={ROW_H}
              selected={s.id === selectedId}
              isChecked={checked?.has(s.id)}
              musicColumns={musicColumns}
              collections={collections}
              onSelect={onSelect}
              onToggleFav={onToggleFav}
              onAddToCollection={onAddToCollection}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
