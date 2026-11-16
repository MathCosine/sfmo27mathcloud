/**
 * One way to call the backend, whichever it is: Supabase in production, or
 * the same SQL running in the browser (PGlite) for the demo. Every call is a
 * database function taking one JSON argument.
 *
 * This file also keeps the two things every screen depends on: the server's
 * clock (so countdowns agree with the deadline the database enforces) and the
 * connection state shown in the corner.
 */
import { useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(message: string, public code = 'error', public transient = false) {
    super(message);
  }
}

export type StaffUser = { id: string; email: string };

export interface Backend {
  kind: 'supabase' | 'demo';
  call(fn: string, p: object, signal?: AbortSignal): Promise<unknown>;
  staff: {
    current(): Promise<StaffUser | null>;
    signIn(email: string, password: string): Promise<void>;
    signUp(email: string, password: string): Promise<{ confirm: boolean }>;
    signOut(): Promise<void>;
    resetPassword(email: string): Promise<void>;
    updatePassword(password: string): Promise<void>;
  };
}

// ---------------------------------------------------------------- tiny stores

export function createStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: T | ((v: T) => T)) {
      value = typeof next === 'function' ? (next as (v: T) => T)(value) : next;
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// ---------------------------------------------------------------- server clock

let offset = 0;
let bestRtt = Infinity;
let samples = 0;

function observeClock(serverNow: unknown, sent: number, received: number) {
  if (typeof serverNow !== 'string') return;
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server)) return;
  const rtt = received - sent;
  // Prefer the fastest round trips; slowly forget old ones so drift is tracked.
  bestRtt = Math.min(bestRtt * 1.02, bestRtt + 50);
  if (rtt <= bestRtt || samples < 3) {
    bestRtt = Math.min(bestRtt, rtt);
    offset = server - (sent + received) / 2;
  }
  samples++;
}

/** Milliseconds since the epoch, by the server's clock. */
export const serverNow = () => Date.now() + offset;

// ---------------------------------------------------------------- connection

export type Connection = { state: 'ok' | 'trouble' | 'offline'; failures: number; lastOk: number };
export const connection = createStore<Connection>({ state: 'ok', failures: 0, lastOk: Date.now() });

function markOk() {
  const c = connection.get();
  if (c.state !== 'ok' || c.failures) connection.set({ state: 'ok', failures: 0, lastOk: Date.now() });
  else c.lastOk = Date.now();
}
function markFailure() {
  connection.set((c) => ({ ...c, failures: c.failures + 1, state: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'trouble' }));
}
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => connection.set((c) => ({ ...c, state: 'offline' })));
  window.addEventListener('online', () => connection.set((c) => ({ ...c, state: c.failures ? 'trouble' : 'ok' })));
}

// ---------------------------------------------------------------- backend

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const IS_DEMO = __DEMO_BUILD__ || !SUPABASE_URL || !SUPABASE_KEY;

let backendPromise: Promise<Backend> | null = null;
export function backend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = IS_DEMO
      ? import('../demo/backend').then((m) => m.createDemoBackend())
      : import('./supabase').then((m) => m.createSupabaseBackend(SUPABASE_URL!, SUPABASE_KEY!));
  }
  return backendPromise;
}

/** True after someone follows a password-reset link. */
export const staffRecovery = createStore(false);

/** Signed-out errors are routed here so the app can send people to sign in. */
export const signedOut = createStore(0);

export async function call<T = any>(fn: string, p: object = {}, opts: { timeoutMs?: number; quiet?: boolean } = {}): Promise<T> {
  const b = await backend();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);
  const sent = Date.now();
  try {
    const data = (await b.call(fn, p, ctrl.signal)) as any;
    markOk();
    if (data && typeof data === 'object') observeClock(data.now, sent, Date.now());
    if (data && typeof data === 'object' && typeof data.error === 'string') throw new ApiError(data.error, data.code ?? 'error');
    return data as T;
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError('Could not reach the server. Retrying…', 'network', true);
    if (ctrl.signal.aborted && !(e instanceof ApiError && !e.transient)) {
      err.message = 'The server took too long to answer. Retrying…';
      err.transient = true;
      err.code = 'timeout';
    }
    if (err.transient) markFailure();
    if (err.code === 'signed_out' && fn.startsWith('s_')) signedOut.set((n) => n + 1);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
