import { serverNow } from './api';

export const DEFAULT_TZ = 'America/Los_Angeles';

/** 42:07, or 1:02:07 past an hour. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function timeOf(iso: string | null | undefined, tz = DEFAULT_TZ, seconds = false): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

export function dateOf(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(new Date(iso));
  } catch {
    return new Date(iso).toDateString();
  }
}

export function zoneName(tz = DEFAULT_TZ): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

export function ago(iso: string | number | null | undefined): string {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.round((serverNow() - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

export function points(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function score1(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function greeting(tz = DEFAULT_TZ): string {
  let h = new Date().getHours();
  try {
    h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  } catch {
    /* local hour is fine */
  }
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** "2027-01-16T09:20" in the given zone, for <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The reverse: a wall-clock time in `tz` to an ISO instant. */
export function fromLocalInput(value: string, tz = DEFAULT_TZ): string | null {
  if (!value) return null;
  const guess = Date.parse(value + ':00Z');
  if (!Number.isFinite(guess)) return null;
  // Find the offset of `tz` at that moment and correct for it (twice, for DST edges).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const shown = Date.parse(toLocalInput(new Date(t).toISOString(), tz) + ':00Z');
    t += guess - shown;
  }
  return new Date(t).toISOString();
}

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(name: string, rows: unknown[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
