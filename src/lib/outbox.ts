/**
 * Answers on their way to the server.
 *
 * Every keystroke updates the latest value for that box; a short pause (or
 * leaving the box) sends it. If the connection drops, the latest value per box
 * waits here, survives a page reload (local storage), and is sent as soon as
 * the server answers again. Only the newest value per box is ever sent.
 */
import { ApiError, call, createStore, useStore } from './api';
import { normalize } from './answers';
import { storageGet, storageSet, toast } from './hooks';
import { token, studentSession } from './session';

type Item = { round: string; problem: string; raw: string; norm: string; v: number };
export type BoxState = { state: 'typing' | 'saving' | 'saved' | 'waiting' | 'error'; at?: number; message?: string };

const items = new Map<string, Item>();
/** The last value the server confirmed for each box, until the next poll catches up. */
const sent = new Map<string, string>();
export const boxes = createStore<Record<string, BoxState>>({});
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let failures = 0;

const storeKey = () => `sfmo27-outbox-${studentSession.get()?.student.id ?? 'none'}`;
const keyOf = (round: string, problem: string) => `${round}:${problem}`;

function persist() {
  storageSet(storeKey(), items.size ? [...items.values()] : null);
}

function setBox(key: string, s: BoxState) {
  boxes.set((b) => ({ ...b, [key]: s }));
}

function restore() {
  items.clear();
  for (const it of storageGet<Item[]>(storeKey(), [])) {
    items.set(keyOf(it.round, it.problem), it);
    setBox(keyOf(it.round, it.problem), { state: 'waiting' });
  }
  if (items.size) schedule(300);
}
restore();
studentSession.subscribe(restore);

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(flush, ms);
}

export function putAnswer(round: string, problem: string, raw: string, delay = 600) {
  const key = keyOf(round, problem);
  items.set(key, { round, problem, raw, norm: normalize(raw), v: ++version });
  persist();
  setBox(key, { state: 'typing' });
  schedule(delay);
}

export function flushSoon() {
  schedule(0);
}

export function pendingFor(round: string, problem: string): string | undefined {
  return items.get(keyOf(round, problem))?.raw;
}

/** What this device last typed in a box: waiting to send, or just saved. */
export function localFor(round: string, problem: string): string | undefined {
  const key = keyOf(round, problem);
  return items.get(key)?.raw ?? sent.get(key);
}

async function flush() {
  if (running) return;
  running = true;
  try {
    for (const [key, it] of [...items]) {
      setBox(key, { state: 'saving' });
      try {
        await call('s_save', { token: token(), round: it.round, problem: it.problem, raw: it.raw, norm: it.norm });
        failures = 0;
        sent.set(key, it.raw);
        if (items.get(key)?.v === it.v) {
          items.delete(key);
          setBox(key, { state: 'saved', at: Date.now() });
        }
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(String(e));
        if (err.transient) {
          failures++;
          for (const k of items.keys()) setBox(k, { state: 'waiting' });
          schedule(Math.min(15000, 800 * 2 ** Math.min(failures, 5)));
          return;
        }
        // The server said no for good (time's up, set handed in): don't retry.
        items.delete(key);
        setBox(key, { state: 'error', message: err.message });
        if (err.code !== 'signed_out') toast(err.message, 'bad');
      } finally {
        persist();
      }
    }
  } finally {
    running = false;
    if ([...items.values()].some(Boolean) && failures === 0) schedule(400);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => schedule(0));
  window.addEventListener('beforeunload', (e) => {
    if (items.size) {
      persist();
      e.preventDefault();
    }
  });
}

export function useBoxes() {
  return useStore(boxes);
}

export function outboxSummary(b: Record<string, BoxState>, round: string) {
  let saving = 0;
  let waiting = 0;
  let last = 0;
  for (const [k, s] of Object.entries(b)) {
    if (!k.startsWith(round + ':')) continue;
    if (s.state === 'saving' || s.state === 'typing') saving++;
    if (s.state === 'waiting') waiting++;
    if (s.at && s.at > last) last = s.at;
  }
  return { saving, waiting, last };
}
