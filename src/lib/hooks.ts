import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createStore, useStore } from './api';

// ---------------------------------------------------------------- routing
// Plain hash names (#staff-roster, #round-individual) so links work on any
// static host, including a sub-path, without server rewrites.

const route = createStore(typeof location !== 'undefined' ? location.hash.slice(1) : '');
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.set(location.hash.slice(1));
    window.scrollTo({ top: 0 });
  });
}
export const useRoute = () => useStore(route);
export function go(to: string) {
  if (location.hash.slice(1) === to) return;
  location.hash = to;
}

// ---------------------------------------------------------------- toasts

export type Toast = { id: number; text: string; tone: 'info' | 'good' | 'bad' };
export const toasts = createStore<Toast[]>([]);
let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info', ms = 4200) {
  const id = ++toastId;
  toasts.set((t) => [...t.slice(-3), { id, text, tone }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), ms);
}

// ---------------------------------------------------------------- polling

export type PollState<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Calls `load` now and then every `ms` while mounted. Transient failures back
 * off (1, 2, 4… up to 20 s) and keep the last good data on screen. Never has
 * two requests in flight. Polls a third as often while the tab is hidden.
 */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const busy = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const alive = useRef(true);
  const msRef = useRef(ms);
  msRef.current = ms;

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    let next = msRef.current;
    try {
      const d = await loadRef.current();
      if (!alive.current) return;
      setData(d);
      setError(null);
      failures.current = 0;
    } catch (e) {
      if (!alive.current) return;
      const err = e instanceof ApiError ? e : new ApiError(String(e));
      setError(err);
      if (err.transient) {
        failures.current++;
        next = Math.min(20000, 1000 * 2 ** (failures.current - 1));
      }
    } finally {
      busy.current = false;
      if (alive.current) {
        setLoading(false);
        const hidden = typeof document !== 'undefined' && document.hidden;
        timer.current = setTimeout(run, hidden ? next * 3 : next);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    run();
    const wake = () => {
      if (!document.hidden) run();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh: run };
}

/** Re-renders every `ms` (for clocks). */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Re-renders on every animation frame while `on`. */
export function useFrame(on = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    let id = 0;
    const loop = () => {
      set((n) => (n + 1) % 1e9);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [on]);
}

export function usePrevious<T>(v: T): T | undefined {
  const r = useRef<T | undefined>(undefined);
  useEffect(() => {
    r.current = v;
  });
  return r.current;
}

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function storageGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function storageSet(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the app still works, it just forgets */
  }
}
