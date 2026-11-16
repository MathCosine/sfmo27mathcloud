import { useMemo, useRef, useState } from 'react';
import { ApiError, call, serverNow } from '../../lib/api';
import { points, score1, timeOf, DEFAULT_TZ } from '../../lib/format';
import { go, toast, usePoll } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, ErrorNote, Modal, PageLoading, Seg, Switch } from '../../ui/kit';
import { Sonar } from '../../ui/Sonar';
import { LiveScore } from '../../ui/live';
import { scoreAt, type BoardRow, type FeedItem, type Mod } from '../student/MysteryRound';
import { RoundControls, StateChip } from './Control';
import { useStaff, type StaffRound } from './StaffApp';

type ConsoleData = {
  now: string;
  round: StaffRound;
  board: (BoardRow & { pending: boolean; answered: number; correct: number })[];
  feed: FeedItem[];
  mods: Mod[];
  problem_count: number;
};

type TargetMode = 'all' | 'pick' | 'random' | 'top' | 'bottom';
type EventSpec = {
  key: string; label: string; icon: string; tone: 'danger' | 'good' | 'blue' | 'warm' | ''; blurb: string;
  type: 'add' | 'set' | 'salvage' | 'mod' | 'note';
  value?: number; mod_kind?: 'sink' | 'patch' | 'torpedo' | 'armor'; factor?: number; seconds?: number | null;
  target: TargetMode; n?: number; message: string;
};

export const PRESETS: EventSpec[] = [
  { key: 'nuke', label: 'NUKE', icon: 'radiation', tone: 'danger', blurb: '−100 to one team you pick', type: 'add', value: -100, target: 'pick', message: 'A nuclear depth charge. Direct hit.' },
  { key: 'salvage', label: "Non-trivial's Salvage", icon: 'lifebuoy', tone: 'good', blurb: 'Every Rock Bottom team back to 10', type: 'salvage', value: 10, target: 'all', message: 'Every submarine on the sea floor is hauled back up to 10.' },
  { key: 'riptide', label: 'Riptide', icon: 'wave', tone: 'blue', blurb: 'Everyone sinks ×2 for 60 s', type: 'mod', mod_kind: 'sink', factor: 2, seconds: 60, target: 'all', message: 'A strong current: everyone sinks twice as fast for a minute.' },
  { key: 'calm', label: 'Calm waters', icon: 'snow', tone: 'blue', blurb: 'Nobody sinks for 60 s', type: 'mod', mod_kind: 'sink', factor: 0, seconds: 60, target: 'all', message: 'The sea goes still. Nobody sinks for a minute.' },
  { key: 'vent', label: 'Thermal vent', icon: 'bubbles', tone: 'good', blurb: 'Everyone rises for 30 s', type: 'mod', mod_kind: 'sink', factor: -1, seconds: 30, target: 'all', message: 'Warm water from below: every submarine rises for 30 seconds.' },
  { key: 'kraken', label: 'Kraken', icon: 'tentacle', tone: 'danger', blurb: '−40 to a random team', type: 'add', value: -40, target: 'random', n: 1, message: 'Something large grabbed a submarine.' },
  { key: 'depth', label: 'Depth charge', icon: 'bolt', tone: 'danger', blurb: '−15 to everyone', type: 'add', value: -15, target: 'all', message: 'Depth charges everywhere. Everyone takes 15.' },
  { key: 'leak', label: 'Leak', icon: 'wave', tone: 'warm', blurb: 'One team sinks ×3 for 90 s', type: 'mod', mod_kind: 'sink', factor: 3, seconds: 90, target: 'pick', message: 'A leak in the hull: sinking three times as fast for 90 seconds.' },
  { key: 'supply', label: 'Supply drop', icon: 'gift', tone: 'good', blurb: 'Patches worth ×2 for 2 min', type: 'mod', mod_kind: 'patch', factor: 2, seconds: 120, target: 'all', message: 'Spare parts! Patches are worth double for two minutes.' },
  { key: 'frenzy', label: 'Torpedo frenzy', icon: 'torpedo', tone: 'warm', blurb: 'Torpedoes ×2 for 2 min', type: 'mod', mod_kind: 'torpedo', factor: 2, seconds: 120, target: 'all', message: 'Torpedoes do double damage for two minutes.' },
  { key: 'shield', label: 'Shields up', icon: 'shield', tone: 'blue', blurb: 'Picked teams take no torpedo damage, 2 min', type: 'mod', mod_kind: 'armor', factor: 0, seconds: 120, target: 'pick', message: 'Shields up: torpedoes bounce off for two minutes.' },
  { key: 'rescue', label: 'Rescue sub', icon: 'lifebuoy', tone: 'good', blurb: '+25 to the three deepest teams still afloat', type: 'add', value: 25, target: 'bottom', n: 3, message: 'A rescue sub tows the three deepest crews up.' },
  { key: 'shark', label: 'Shark attack', icon: 'fin', tone: 'danger', blurb: '−25 to the top three', type: 'add', value: -25, target: 'top', n: 3, message: 'Sharks go for the shiniest submarines.' },
  { key: 'note', label: 'Message only', icon: 'megaphone', tone: '', blurb: 'Pops up on every screen, changes nothing', type: 'note', target: 'all', message: '' },
  { key: 'custom', label: 'Custom event', icon: 'edit', tone: '', blurb: 'Your own effect, value and targets', type: 'add', value: -20, target: 'pick', message: '' },
];
const ICONS = ['radiation', 'lifebuoy', 'wave', 'snow', 'bubbles', 'tentacle', 'bolt', 'gift', 'torpedo', 'shield', 'fin', 'megaphone', 'wrench', 'anchor'];

export function Dive() {
  const { s, tz } = useStaff();
  const round = s.rounds.find((r) => r.kind === 'mystery');
  if (!round) return <div className="empty"><h3>There's no Mystery Dive round.</h3><p>Create one under <button className="linkish" onClick={() => go('staff-rounds')}>Rounds &amp; problems</button>.</p></div>;
  return <Console roundId={round.id} tz={tz} />;
}

function Console({ roundId, tz }: { roundId: string; tz: string }) {
  const { s } = useStaff();
  const since = useRef(0);
  const readAt = useRef(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'attacks' | 'events' | 'answers'>('all');
  const [event, setEvent] = useState<EventSpec | null>(null);
  const [adjust, setAdjust] = useState<string | null>(null);
  const data = usePoll(async () => {
    const d = await call<ConsoleData>('st_mystery', { round: roundId, since: since.current });
    readAt.current = Date.parse(d.now);
    if (d.feed.length) {
      since.current = Math.max(since.current, ...d.feed.map((f) => f.id));
      setFeed((p) => [...d.feed.slice().reverse(), ...p].slice(0, 400));
    }
    return d;
  }, 2000, [roundId]);
  const d = data.data;
  const round = s.rounds.find((r) => r.id === roundId) ?? d?.round;
  const names = useMemo(() => Object.fromEntries((d?.board ?? []).map((b) => [b.id, b.name])), [d?.board]);
  if (!d || !round) return data.error ? <ErrorNote error={data.error} onRetry={data.refresh} /> : <PageLoading />;
  const t = serverNow();
  const ranked = [...d.board].sort((a, b) => scoreAt(b, readAt.current, t) - scoreAt(a, readAt.current, t) || a.id.localeCompare(b.id));
  const sunkCount = d.board.filter((b) => b.sunk).length;
  const running = round.state === 'open' || round.state === 'paused';
  const shown = feed.filter((f) =>
    filter === 'all' ? true : filter === 'attacks' ? f.kind === 'torpedo' || f.kind === 'patch' || f.kind === 'sunk' : filter === 'events' ? ['event', 'mod_end', 'pause', 'resume', 'close'].includes(f.kind) : f.kind === 'correct' || f.kind === 'wrong');
  const mods = d.mods.filter((m) => !m.label.startsWith('__'));
  const cfg = round.config;

  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Mystery console</span>
          <div className="row" style={{ marginTop: 6 }}><h1 style={{ fontSize: 34 }}>{round.title}</h1><StateChip r={round} /></div>
          <p>Start {cfg.start ?? 200} · sinks {cfg.sink_rate ?? 0.1}/s · patch +{cfg.patch ?? 20} · torpedo −{cfg.torpedo ?? 10} · {d.problem_count} questions · {sunkCount} at Rock Bottom</p>
        </div>
        <div className="row"><RoundControls r={round} /><a className="btn btn-sm" href={`#board-${roundId}`} target="_blank" rel="noreferrer"><Icon name="monitor" size={15} />Projector</a></div>
      </header>

      <div className="dive-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
        <div className="stack" style={{ gap: 22, minWidth: 0 }}>
          <section>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h2>Events</h2>
              <span className="faint" style={{ fontSize: 13 }}>{running ? 'Tap one to review, then fire.' : 'Start the dive to run events.'}</span>
            </div>
            <div className="event-grid stagger">
              {PRESETS.map((p, i) => (
                <button key={p.key} className={`event-btn ${p.tone}`} style={{ ['--i' as string]: i }} onClick={() => setEvent(p)} disabled={!running}>
                  <span className="ico"><Icon name={p.icon} size={18} /></span>
                  <b style={{ fontSize: 14.5 }}>{p.label}</b>
                  <span className="faint" style={{ fontSize: 12.5, lineHeight: 1.35 }}>{p.blurb}</span>
                </button>
              ))}
            </div>
          </section>

          {mods.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Active effects</h3><span className="faint" style={{ fontSize: 13 }}>{mods.length}</span></div>
              {mods.map((m) => <ModRow key={m.id} m={m} onEnd={data.refresh} />)}
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h3>Board</h3>
              <span className="faint" style={{ fontSize: 13 }}>Tap a team to adjust its score by hand</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>Team</th><th className="r">Depth</th><th>Status</th><th className="r">Right / tried</th><th /></tr></thead>
                <tbody>
                  {ranked.map((b, i) => (
                    <tr key={b.id}>
                      <td className="mono faint">{i + 1}</td>
                      <td><span className="mono faint">{b.id}</span> {b.name}</td>
                      <td className="r mono" style={{ fontSize: 15 }}>{b.sunk ? '0.0' : <LiveScore row={b} readAt={readAt.current} />}</td>
                      <td>
                        {b.sunk ? <span className="chip chip-bad">Rock Bottom</span> : b.rate < 0 ? <span className="chip chip-good">Rising</span> : b.rate === 0 ? <span className="chip chip-blue">Holding</span> : b.rate > Number(cfg.sink_rate ?? 0.1) + 1e-9 ? <span className="chip chip-warn">Sinking ×{score1(b.rate / Number(cfg.sink_rate ?? 0.1))}</span> : <span className="chip">Sinking</span>}
                        {b.pending && <span className="chip chip-live" style={{ marginLeft: 6 }}>Hit ready</span>}
                      </td>
                      <td className="r mono">{b.correct}/{b.answered}</td>
                      <td className="r"><Button size="xs" onClick={() => setAdjust(b.id)} disabled={!running}>Adjust</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="stack" style={{ gap: 18, minWidth: 0 }}>
          <div className="sonar-wrap"><Sonar blips={d.board.map((b) => ({ id: b.id, score: scoreAt(b, readAt.current), sunk: b.sunk }))} max={Number(cfg.start ?? 200)} /></div>
          <section>
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="eyebrow">Log</span>
              <Seg label="Filter the log" value={filter} onChange={setFilter} options={[['all', 'All'], ['attacks', 'Attacks'], ['events', 'Events'], ['answers', 'Answers']]} />
            </div>
            <div className="feed" style={{ maxHeight: 560 }}>
              {shown.length === 0 && <p className="faint" style={{ fontSize: 13.5, padding: '10px 0' }}>Nothing yet.</p>}
              {shown.map((f) => (
                <div key={f.id} className={`feed-item ${f.kind === 'event' ? 'event' : ''}`}>
                  <time>{timeOf(f.at, tz || DEFAULT_TZ, true).replace(/\s?[AP]M$/, '')}</time>
                  <Icon name={f.kind === 'wrong' ? 'x' : f.kind === 'correct' ? 'check' : f.kind === 'torpedo' ? 'torpedo' : f.kind === 'patch' ? 'wrench' : f.kind === 'sunk' ? 'anchor' : 'bolt'} size={16} />
                  <span>
                    {f.kind === 'correct' || f.kind === 'wrong'
                      ? <><b>{f.team_id} {names[f.team_id ?? ''] ?? ''}</b> {f.kind === 'correct' ? 'got' : 'missed'} #{f.meta?.number}{f.kind === 'wrong' ? <span className="mono faint"> “{f.meta?.raw}”</span> : null}</>
                      : <FeedText f={f} names={names} />}
                    {f.by && <span className="faint" style={{ fontSize: 12 }}> · {f.by}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {event && <EventModal spec={event} board={d.board} readAt={readAt.current} roundId={roundId} onClose={() => setEvent(null)} onDone={data.refresh} />}
      {adjust && <AdjustModal team={d.board.find((b) => b.id === adjust)!} readAt={readAt.current} roundId={roundId} onClose={() => setAdjust(null)} onDone={data.refresh} />}
    </>
  );
}

function FeedText({ f, names }: { f: FeedItem; names: Record<string, string> }) {
  const n = (id: string | null) => (id ? `${id} ${names[id] ?? ''}`.trim() : 'Someone');
  const delta = f.delta !== null && f.delta !== undefined ? <span className="mono" style={{ color: f.delta >= 0 ? 'var(--good)' : 'var(--bad)', marginLeft: 6 }}>{f.delta >= 0 ? '+' : '−'}{points(Math.abs(Math.round(f.delta * 10) / 10))}</span> : null;
  if (f.kind === 'torpedo') return <><b>{n(f.team_id)}</b> torpedoed <b>{n(f.target_id)}</b>{delta}</>;
  if (f.kind === 'patch') return <><b>{n(f.team_id)}</b> patched{delta}</>;
  if (f.kind === 'sunk') return <><b>{n(f.team_id)}</b> hit Rock Bottom</>;
  if (f.kind === 'event') {
    const who = !f.targets || f.targets.includes('ALL') ? 'everyone' : f.targets.join(', ') || 'nobody';
    return <><b>{f.label}</b> · {who}{delta}{!f.public && <span className="chip chip-outline" style={{ marginLeft: 6 }}>Hidden</span>}</>;
  }
  if (f.kind === 'mod_end') return <><b>{f.label}</b> ended</>;
  return <>{f.label ?? f.kind}</>;
}

function ModRow({ m, onEnd }: { m: Mod; onEnd: () => void }) {
  const [busy, setBusy] = useState(false);
  const left = m.ends_at ? Math.max(0, Math.round((Date.parse(m.ends_at) - serverNow()) / 1000)) : null;
  const what = m.kind === 'sink' ? (m.factor === 0 ? 'No sinking' : m.factor < 0 ? `Rising ×${-m.factor}` : `Sinking ×${m.factor}`) : m.kind === 'patch' ? `Patches ×${m.factor}` : m.kind === 'torpedo' ? `Torpedoes ×${m.factor}` : `Damage taken ×${m.factor}`;
  return (
    <div className="spread" style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)' }}>
      <div>
        <b>{m.label}</b> <span className="muted">· {what} · {m.team_id ? `Team ${m.team_id}` : 'everyone'}</span>
        <div className="faint mono" style={{ fontSize: 12.5 }}>{left === null ? 'until you end it' : `${left}s left`}</div>
      </div>
      <Button size="sm" busy={busy} onClick={async () => {
        setBusy(true);
        try { await call('st_mystery_mod_end', { id: m.id }); toast(`${m.label} ended.`); onEnd(); } catch (e) { toast(e instanceof ApiError ? e.message : String(e), 'bad'); } finally { setBusy(false); }
      }}>End now</Button>
    </div>
  );
}

function resolveTargets(mode: TargetMode, n: number, picked: string[], board: BoardRow[], readAt: number, type: EventSpec['type']): string[] {
  const t = serverNow();
  const afloat = board.filter((b) => !b.sunk).sort((a, b) => scoreAt(b, readAt, t) - scoreAt(a, readAt, t));
  if (mode === 'all') return ['ALL'];
  if (mode === 'pick') return picked;
  if (type === 'salvage') return ['ALL'];
  if (mode === 'top') return afloat.slice(0, n).map((b) => b.id);
  if (mode === 'bottom') return afloat.slice(-n).map((b) => b.id);
  const pool = [...afloat];
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
  return out;
}

function EventModal({ spec, board, readAt, roundId, onClose, onDone }: { spec: EventSpec; board: BoardRow[]; readAt: number; roundId: string; onClose: () => void; onDone: () => void }) {
  const [e, setE] = useState<EventSpec>({ ...spec, label: spec.key === 'custom' ? '' : spec.label });
  const [picked, setPicked] = useState<string[]>(() => (spec.target === 'pick' && spec.key === 'nuke' ? [[...board].filter((b) => !b.sunk).sort((a, b) => scoreAt(b, readAt) - scoreAt(a, readAt))[0]?.id].filter(Boolean) as string[] : []));
  const [publicEvt, setPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rolled, setRolled] = useState(0);
  const targets = useMemo(() => resolveTargets(e.target, e.n ?? 1, picked, board, readAt, e.type), [e.target, e.n, picked, board, readAt, e.type, rolled]);
  const set = (patch: Partial<EventSpec>) => setE((x) => ({ ...x, ...patch }));
  const t = serverNow();
  const describe = e.type === 'add' ? `${(e.value ?? 0) >= 0 ? '+' : ''}${e.value ?? 0} to each target` : e.type === 'set' ? `Set each target to ${e.value}` : e.type === 'salvage' ? `Every Rock Bottom team back to ${e.value ?? 10}` : e.type === 'mod' ? `${e.mod_kind} ×${e.factor} ${e.seconds ? `for ${e.seconds}s` : 'until you end it'}` : 'A message on every screen';
  const fire = async () => {
    if (!e.label.trim()) return toast('Give the event a name.', 'bad');
    if (e.type !== 'note' && e.type !== 'salvage' && !targets.length) return toast('Pick at least one team.', 'bad');
    setBusy(true);
    try {
      const r = await call<{ affected: unknown[]; targets: string[] }>('st_mystery_event', {
        round: roundId, type: e.type, value: e.value, mod_kind: e.mod_kind, factor: e.factor, seconds: e.seconds ?? null,
        targets: e.type === 'note' ? ['all'] : targets, label: e.label, message: e.message, icon: e.icon, public: publicEvt,
      });
      toast(`${e.label} fired${e.type === 'salvage' ? ` · ${r.targets.length} team${r.targets.length === 1 ? '' : 's'} saved` : ''}.`, 'good');
      onDone();
      onClose();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : String(x), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={() => !busy && onClose()} label={e.label || 'Event'} wide>
      <div className="modal-body stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className={`event-btn ${spec.tone}`} style={{ padding: 0, border: 0, background: 'none', cursor: 'default' }}><span className="ico"><Icon name={e.icon} size={20} /></span></span>
          <div className="grow"><span className="eyebrow">Event</span><h2>{e.label || 'Custom event'}</h2></div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field grow"><label htmlFor="ev-label">Name on screens</label><input id="ev-label" className="input" value={e.label} maxLength={60} onChange={(x) => set({ label: x.target.value })} /></div>
          <div className="field" style={{ width: 150 }}><label htmlFor="ev-icon">Icon</label>
            <select id="ev-icon" className="select" value={e.icon} onChange={(x) => set({ icon: x.target.value })}>{ICONS.map((i) => <option key={i} value={i}>{i}</option>)}</select>
          </div>
        </div>
        <div className="field"><label htmlFor="ev-msg">Message (optional)</label><input id="ev-msg" className="input" value={e.message} maxLength={280} onChange={(x) => set({ message: x.target.value })} /></div>

        {spec.key === 'custom' || spec.key === 'note' ? (
          <div className="field"><span className="label">What it does</span>
            <Seg label="Effect" value={e.type} onChange={(v) => set({ type: v, target: v === 'salvage' || v === 'note' ? 'all' : e.target })} options={[['add', 'Add / take points'], ['set', 'Set score'], ['mod', 'Timed effect'], ['salvage', 'Salvage'], ['note', 'Message only']]} />
          </div>
        ) : null}

        {(e.type === 'add' || e.type === 'set' || e.type === 'salvage') && (
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="ev-val">{e.type === 'add' ? 'Points (negative takes away)' : e.type === 'set' ? 'New score' : 'Bring them back to'}</label>
            <input id="ev-val" className="input mono" type="number" value={e.value ?? 0} onChange={(x) => set({ value: Number(x.target.value) })} />
          </div>
        )}
        {e.type === 'mod' && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ width: 200 }}><label htmlFor="ev-kind">Changes</label>
              <select id="ev-kind" className="select" value={e.mod_kind} onChange={(x) => set({ mod_kind: x.target.value as EventSpec['mod_kind'] })}>
                <option value="sink">Sinking speed</option><option value="patch">What patches are worth</option><option value="torpedo">Torpedo damage dealt</option><option value="armor">Torpedo damage taken</option>
              </select>
            </div>
            <div className="field" style={{ width: 130 }}><label htmlFor="ev-f">Multiplier</label><input id="ev-f" className="input mono" type="number" step="0.5" value={e.factor ?? 1} onChange={(x) => set({ factor: Number(x.target.value) })} /></div>
            <div className="field" style={{ width: 150 }}><label htmlFor="ev-s">Seconds (blank = until ended)</label><input id="ev-s" className="input mono" type="number" min={1} value={e.seconds ?? ''} onChange={(x) => set({ seconds: x.target.value ? Number(x.target.value) : null })} /></div>
          </div>
        )}

        {e.type !== 'note' && e.type !== 'salvage' && (
          <div className="field">
            <span className="label">Who</span>
            <div className="row">
              <Seg label="Targets" value={e.target} onChange={(v) => set({ target: v })} options={[['all', 'Everyone'], ['pick', 'Pick teams'], ['random', 'Random'], ['top', 'Top'], ['bottom', 'Deepest afloat']]} />
              {(e.target === 'random' || e.target === 'top' || e.target === 'bottom') && (
                <input className="input mono" style={{ width: 80, height: 34 }} type="number" min={1} max={board.length} value={e.n ?? 1} onChange={(x) => set({ n: Math.max(1, Number(x.target.value)) })} aria-label="How many teams" />
              )}
              {e.target === 'random' && <Button size="sm" icon="refresh" onClick={() => setRolled((n) => n + 1)}>Re-roll</Button>}
            </div>
            {e.target === 'pick' && (
              <div className="targets" style={{ maxHeight: 220, border: '1px solid var(--line)', borderRadius: 14, padding: 6 }}>
                {[...board].sort((a, b) => scoreAt(b, readAt, t) - scoreAt(a, readAt, t)).map((b) => (
                  <label key={b.id} className={`target ${picked.includes(b.id) ? 'on' : ''}`} style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.includes(b.id)} onChange={(x) => setPicked((p) => (x.target.checked ? [...p, b.id] : p.filter((y) => y !== b.id)))} style={{ accentColor: 'var(--ink)' }} />
                    <span>{b.id} {b.name}</span>
                    <span className="mono">{b.sunk ? 'Rock Bottom' : score1(scoreAt(b, readAt, t))}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="sunk" style={{ padding: '12px 16px', fontSize: 14 }}>
          <span className="eyebrow">What happens</span>
          <div style={{ marginTop: 4 }}>{describe}{e.type !== 'note' && e.type !== 'salvage' ? <> · <b>{targets[0] === 'ALL' ? 'every team' : targets.length ? targets.join(', ') : 'no teams yet'}</b></> : null}.</div>
          {e.type === 'add' && (e.value ?? 0) > 0 && <div className="faint" style={{ fontSize: 13, marginTop: 4 }}>Teams at Rock Bottom aren't lifted by points; use Salvage for that.</div>}
        </div>
        <Switch id="ev-public" checked={publicEvt} onChange={setPublic} label="Show it on students' screens and the feed" />
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={spec.tone === 'danger' ? 'danger' : 'accent'} icon={e.icon} busy={busy} onClick={fire}>Fire {e.label || 'event'}</Button>
      </div>
    </Modal>
  );
}

function AdjustModal({ team, readAt, roundId, onClose, onDone }: { team: BoardRow; readAt: number; roundId: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [value, setValue] = useState('10');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label={`Adjust team ${team.id}`}>
      <div className="modal-body stack" style={{ gap: 14 }}>
        <span className="eyebrow">Team {team.id}</span>
        <h2>{team.name} · {team.sunk ? 'Rock Bottom' : score1(scoreAt(team, readAt))}</h2>
        <Seg label="How" value={mode} onChange={setMode} options={[['add', 'Add or take points'], ['set', 'Set the score']]} />
        <div className="field"><label htmlFor="adj-v">{mode === 'add' ? 'Points (negative takes away)' : 'New score'}</label><input id="adj-v" className="input mono" type="number" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        <div className="field"><label htmlFor="adj-r">Reason (for the log)</label><input id="adj-r" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Answer accepted on appeal" /></div>
        {mode === 'add' && team.sunk && <p className="faint" style={{ fontSize: 13 }}>Rock Bottom teams ignore added points. Setting a score brings them back.</p>}
      </div>
      <div className="modal-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={async () => {
          setBusy(true);
          try {
            await call('st_mystery_event', { round: roundId, type: mode, value: Number(value), targets: [team.id], label: reason.trim() || 'Proctor adjustment', public: false, icon: 'wrench' });
            toast(`Team ${team.id} adjusted.`, 'good');
            onDone();
            onClose();
          } catch (e) {
            toast(e instanceof ApiError ? e.message : String(e), 'bad');
          } finally {
            setBusy(false);
          }
        }}>Apply</Button>
      </div>
    </Modal>
  );
}
