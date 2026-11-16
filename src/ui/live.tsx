import { useEffect, useRef } from 'react';
import { serverNow } from '../lib/api';

/**
 * Scores that sink in real time without re-rendering React: one animation
 * loop (about 15 updates a second) writes the text of every live score.
 */
type Entry = { el: HTMLElement; row: { score: number; rate: number; sunk: boolean }; readAt: number; digits: number };
const entries = new Set<Entry>();
let running = false;
let last = 0;

function loop(t: number) {
  if (!entries.size) {
    running = false;
    return;
  }
  if (t - last > 66) {
    last = t;
    const now = serverNow();
    for (const e of entries) {
      const v = e.row.sunk ? 0 : Math.max(0, e.row.score - (e.row.rate * (now - e.readAt)) / 1000);
      const text = v.toFixed(e.digits);
      if (e.el.textContent !== text) e.el.textContent = text;
    }
  }
  requestAnimationFrame(loop);
}

export function LiveScore({ row, readAt, digits = 1 }: { row: { score: number; rate: number; sunk: boolean }; readAt: number; digits?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const entry = useRef<Entry | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const e: Entry = { el: ref.current, row, readAt, digits };
    entry.current = e;
    entries.add(e);
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
    return () => {
      entries.delete(e);
    };
  }, []);
  useEffect(() => {
    if (entry.current) Object.assign(entry.current, { row, readAt, digits });
  }, [row, readAt, digits]);
  const initial = row.sunk ? 0 : Math.max(0, row.score - (row.rate * (serverNow() - readAt)) / 1000);
  return <span ref={ref} className="num">{initial.toFixed(digits)}</span>;
}
