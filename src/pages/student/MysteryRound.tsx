import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, call, serverNow, useStore } from '../../lib/api';
import { normalize } from '../../lib/answers';
import { DEFAULT_TZ, ms, points, score1, timeOf } from '../../lib/format';
import { go, toast, usePoll } from '../../lib/hooks';
import { token, useStudent } from '../../lib/session';
import { Icon } from '../../ui/icons';
import { Button, ErrorNote, Modal, PageLoading, Rich, Spinner } from '../../ui/kit';
import { Sonar } from '../../ui/Sonar';
import { LiveScore } from '../../ui/live';
import { Announcements, homeCache, type Announcement, type RoundInfo } from './StudentApp';
import { RoundClock, WaitingRoom, useIntegrity, AwayNotice } from './RoundPage';

export type BoardRow = { id: string; name: string; score: number; rate: number; sunk: boolean; sunk_at?: string };
export type FeedItem = {
  id: number; at: string; kind: string; team_id: string | null; target_id: string | null; targets: string[] | null;
  delta: number | null; score_after: number | null; label: string | null; message: string | null; meta: any; public: boolean; by?: string;
};
export type Mod = { id: number; kind: string; factor: number; team_id: string | null; starts_at: string; ends_at: string | null; label: string };
type MysteryData = {
  now: string;
  round: RoundInfo;
  board: BoardRow[];
  feed: FeedItem[];
  mods: Mod[];
  answers: Record<string, { correct: boolean; spent_as: string | null; target_id: string | null; by: string; at: string }>;
  pending: string | null;
  values: { patch: number; torpedo: number };
  problems: { id: string; number: number; points: number; body: string }[] | null;
  announcements: Announcement[];
};

/** Where a score is now, extrapolating from the last reading by its sink rate. */
export const scoreAt = (row: { score: number; rate: number; sunk: boolean }, readAt: number, t = serverNow()) =>
  row.sunk ? 0 : Math.max(0, row.score - (row.rate * (t - readAt)) / 1000);

export const EVENT_ICONS: Record<string, string> = { radiation: 'radiation', lifebuoy: 'lifebuoy', wave: 'wave', bubbles: 'bubbles', tentacle: 'tentacle', shield: 'shield', bolt: 'bolt', gift: 'gift', fin: 'fin', snow: 'snow', torpedo: 'torpedo', wrench: 'wrench', megaphone: 'megaphone' };

export function teamLabel(id: string | null, names: Record<string, string>) {
  if (!id) return 'Someone';
  return `${id}${names[id] ? ' ' + names[id] : ''}`;
}

export function FeedLine({ f, names, me }: { f: FeedItem; names: Record<string, string>; me?: string }) {
  const T = ({ id }: { id: string | null }) => <b>{id === me ? 'You' : teamLabel(id, names)}</b>;
  const d = f.delta !== null && f.delta !== undefined ? <span className="mono" style={{ color: f.delta >= 0 ? 'var(--good)' : 'var(--bad)', marginLeft: 6 }}>{f.delta >= 0 ? '+' : '−'}{points(Math.abs(Math.round(f.delta * 10) / 10))}</span> : null;
  switch (f.kind) {
    case 'torpedo': return <span><T id={f.team_id} /> torpedoed <T id={f.target_id} />{d}</span>;
    case 'patch': return <span><T id={f.team_id} /> patched {f.team_id === me ? 'your' : 'their'} hull{d}</span>;
    case 'sunk': return <span><T id={f.team_id} /> hit Rock Bottom</span>;
    case 'correct': return <span>Your team got a question right</span>;
    case 'wrong': return <span>Your team missed a question{f.meta?.number ? ` (#${f.meta.number})` : ''}</span>;
    case 'mod_end': return <span><b>{f.label}</b> is over</span>;
    case 'pause': return <span>The proctors paused the dive</span>;
    case 'resume': return <span>The dive is back on</span>;
    case 'close': return <span>The dive is over</span>;
    case 'event': {
      const who = !f.targets || f.targets.includes('ALL') ? 'everyone' : f.targets.length > 3 ? `${f.targets.length} teams` : f.targets.map((t) => (t === me ? 'you' : t)).join(', ');
      return <span><b>{f.label}</b>{f.meta?.type === 'note' ? '' : ` · ${who}`}{d}{f.message ? <span className="muted"> — {f.message}</span> : null}</span>;
    }
    default: return <span>{f.label ?? f.kind}</span>;
  }
}

function feedIcon(f: FeedItem) {
  if (f.kind === 'torpedo') return 'torpedo';
  if (f.kind === 'patch') return 'wrench';
  if (f.kind === 'sunk') return 'anchor';
  if (f.kind === 'event') return EVENT_ICONS[f.meta?.icon] ?? 'bolt';
  if (f.kind === 'pause') return 'pause';
  if (f.kind === 'resume') return 'play';
  if (f.kind === 'correct') return 'check';
  if (f.kind === 'wrong') return 'x';
  return 'info';
}

export function Feed({ items, names, me, tz }: { items: FeedItem[]; names: Record<string, string>; me?: string; tz: string }) {
  if (!items.length) return <p className="faint" style={{ fontSize: 13.5, padding: '10px 0' }}>Nothing yet. Torpedoes, patches and events show up here.</p>;
  return (
    <div className="feed" aria-live="polite">
      {items.map((f) => (
        <div key={f.id} className={`feed-item ${f.kind === 'event' ? 'event' : ''} ${me && (f.target_id === me || (f.kind === 'event' && f.targets?.includes(me))) ? 'mine' : ''}`}>
          <time>{timeOf(f.at, tz, true).replace(/\s?[AP]M$/, '')}</time>
          <Icon name={feedIcon(f)} size={16} />
          <FeedLine f={f} names={names} me={me} />
        </div>
      ))}
    </div>
  );
}

export function EventBanner({ f, onDone }: { f: FeedItem; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 7000);
    return () => clearTimeout(t);
  }, [onDone]);
  return createPortal(
    <div className="event-banner" role="alert">
      <span className="badge"><Icon name={EVENT_ICONS[f.meta?.icon] ?? 'bolt'} size={22} /></span>
      <div style={{ minWidth: 0 }}>
        <span className="eyebrow">Proctor event</span>
        <h3>{f.label}</h3>
        {f.message && <p style={{ color: 'var(--deep-ink-2)', fontSize: 14, marginTop: 2 }}>{f.message}</p>}
      </div>
      <button className="btn btn-ghost btn-sm btn-icon" style={{ color: 'var(--deep-ink)' }} onClick={onDone} aria-label="Dismiss"><Icon name="x" size={16} /></button>
    </div>,
    document.body,
  );
}

export function MysteryRound({ id }: { id: string }) {
  const me = useStudent()!;
  const team = me.student.team_id;
  const home = useStore(homeCache);
  const tz = home?.settings.timezone || DEFAULT_TZ;
  const since = useRef(0);
  const annSince = useRef(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [ann, setAnn] = useState<Announcement[]>([]);
  const [problems, setProblems] = useState<MysteryData['problems']>(null);
  const [banner, setBanner] = useState<FeedItem | null>(null);
  const [fx, setFx] = useState<{ kind: 'hit' | 'healed'; delta: number; key: number } | null>(null);
  const [spend, setSpend] = useState(false);
  const readAt = useRef(0);
  const last = useRef<{ score: number; rate: number; sunk: boolean; at: number } | null>(null);
  const first = useRef(true);

  const data = usePoll(async () => {
    const d = await call<MysteryData>('s_mystery', { token: token(), round: id, since: since.current, ann_since: annSince.current, with_problems: !problems });
    readAt.current = Date.parse(d.now);
    if (d.problems) setProblems(d.problems);
    if (d.announcements.length) {
      annSince.current = Math.max(annSince.current, ...d.announcements.map((a) => a.id));
      setAnn((p) => [...d.announcements, ...p].slice(0, 5));
    }
    if (d.feed.length) {
      since.current = Math.max(since.current, ...d.feed.map((f) => f.id));
      setFeed((p) => [...d.feed.slice().reverse(), ...p].slice(0, 150));
      if (!first.current) {
        const ev = d.feed.filter((f) => f.kind === 'event').pop();
        if (ev) setBanner(ev);
        for (const f of d.feed) {
          if (f.kind === 'torpedo' && f.target_id === team) toast(`${f.team_id ? 'Team ' + f.team_id : 'Someone'} torpedoed you · ${points(Math.round((f.delta ?? 0) * 10) / 10)}`, 'bad');
        }
      }
    }
    // Score jumps for our team (beyond normal sinking) get an effect.
    const mine = d.board.find((b) => b.id === team);
    if (mine && last.current && !first.current) {
      const expected = scoreAt(last.current, last.current.at, readAt.current);
      const now = mine.sunk ? 0 : mine.score;
      const diff = now - expected;
      if (Math.abs(diff) >= 0.75) setFx({ kind: diff < 0 ? 'hit' : 'healed', delta: diff, key: Date.now() });
    }
    if (mine) last.current = { ...mine, at: readAt.current };
    first.current = false;
    return d;
  }, 2000, [id]);

  const d = data.data;
  const state = d?.round.state;
  useEffect(() => {
    if (state !== 'waiting' || !d?.round.opens_at) return;
    const left = ms(d.round.opens_at) - serverNow();
    const t = setTimeout(data.refresh, Math.max(300, Math.min(left + 150, 15000)));
    return () => clearTimeout(t);
  }, [state, d, data.refresh]);
  useEffect(() => {
    if (!fx) return;
    const t = setTimeout(() => setFx(null), 1400);
    return () => clearTimeout(t);
  }, [fx]);
  const integ = useIntegrity(id, state === 'open', home?.settings.integrity || 'warn');

  const names = useMemo(() => Object.fromEntries((d?.board ?? []).map((b) => [b.id, b.name])), [d?.board]);
  const ranked = useMemo(() => {
    if (!d) return [];
    const t = serverNow();
    return [...d.board].sort((a, b) => scoreAt(b, readAt.current, t) - scoreAt(a, readAt.current, t) || a.id.localeCompare(b.id));
  }, [d]);

  if (!d) return <div className="wrap">{data.error ? <div className="page"><ErrorNote error={data.error} onRetry={data.refresh} /></div> : <PageLoading />}</div>;
  if (d.round.state === 'waiting') return <WaitingRoom round={d.round} tz={tz} />;

  const mine = d.board.find((b) => b.id === team);
  const sunk = !!mine?.sunk;
  const rank = ranked.findIndex((b) => b.id === team) + 1;
  const live = d.round.state === 'open';
  const closed = d.round.state === 'closed';
  const answered = Object.keys(d.answers).length;
  const right = Object.values(d.answers).filter((a) => a.correct).length;
  const startScore = Number(d.round.config.start ?? 200);
  const topScore = Math.max(startScore, ...d.board.map((b) => b.score));
  const sinkMods = d.mods.filter((m) => m.kind === 'sink' && (m.team_id === null || m.team_id === team));
  const activeMods = d.mods.filter((m) => !m.label.startsWith('__'));

  return (
    <>
      <div className="testbar">
        <div className="wrap testbar-in">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => go('')} aria-label="Back to today"><Icon name="back" /></button>
          <div className="grow">
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.02em' }}>{d.round.title}</div>
            <span className="save-state">{closed ? 'Final depths' : `${answered} of ${problems?.length ?? d.round.problem_count} tried · ${right} right`}</span>
          </div>
          {mine && (
            <div className="testbar-depth" title="Your submarine's depth">
              <span className="eyebrow">Depth</span>
              <span className={`mono ${sunk ? 'sunk' : ''}`}>{sunk ? 'Rock Bottom' : <LiveScore row={mine} readAt={readAt.current} />}</span>
            </div>
          )}
          {closed ? <span className="chip chip-good"><Icon name="check" size={12} />Dive over</span> : <RoundClock round={d.round} />}
        </div>
      </div>

      <div className="wrap page" style={{ paddingTop: 24 }}>
        {(ann.length > 0 || d.round.state === 'paused') && (
          <div className="stack" style={{ gap: 8, marginBottom: 18 }}>
            {d.round.state === 'paused' && <div className="banner banner-urgent"><Icon name="pause" /><div>The proctors paused the dive. Nobody sinks while it's paused, and the clock picks up where it stopped.</div></div>}
            <Announcements items={ann} />
          </div>
        )}

        <div className="dive-grid">
          <div style={{ minWidth: 0 }}>
            {d.pending && live && (
              <div className="banner banner-good pop" style={{ alignItems: 'center', marginBottom: 14 }}>
                <Icon name="check" />
                <div className="grow"><b>Your team has a hit ready.</b> Patch your hull or fire a torpedo before submitting another answer.</div>
                <Button variant="good" size="sm" onClick={() => setSpend(true)}>Use it</Button>
              </div>
            )}
            <div className="rules-intro">
              <Rich text={d.round.rules} className="muted" />
            </div>
            {problems ? (
              problems.map((p, i) => (
                <MysteryQuestion key={p.id} p={p} i={i} roundId={id} answer={d.answers[p.id]} live={live} pending={!!d.pending}
                  onCorrect={async () => { await data.refresh(); setSpend(true); }} refresh={data.refresh} />
              ))
            ) : (
              <p className="faint" style={{ paddingBlock: 30 }}>{closed ? 'The questions are closed.' : 'Loading questions…'}</p>
            )}
          </div>

          <aside className="dive-side stack" style={{ gap: 16, minWidth: 0 }}>
            <section key={fx?.key ?? 0} className={`gauge ${fx?.kind ?? ''} ${sunk ? 'sunk' : ''}`} aria-label="Your submarine">
              <div className="depth-track"><span className="depth-sub" style={{ top: `calc(${sunk ? 100 : (1 - Math.min(1, (mine?.score ?? 0) / topScore)) * 100}% - 5px)` }} /></div>
              <div className="depth-scale" aria-hidden="true"><span>{Math.round(topScore)}</span><span>{Math.round(topScore / 2)}</span><span>0</span></div>
              <div style={{ paddingRight: 80 }}>
                <span className="eyebrow">Team {team} · {me.student.team_name}</span>
                <div className="gauge-score" style={{ marginTop: 10 }} aria-live="off">
                  {mine ? <LiveScore row={mine} readAt={readAt.current} /> : '—'}
                  <small> / {startScore}</small>
                </div>
                {fx && <span className={`delta-float ${fx.delta > 0 ? 'up' : 'down'}`} style={{ left: 26, top: 60 }}>{fx.delta > 0 ? '+' : '−'}{score1(Math.abs(fx.delta))}</span>}
                <div className="gauge-meta">
                  {sunk ? (
                    <span style={{ color: '#ff9a80' }}><b style={{ color: '#ffb6a3' }}>Rock Bottom.</b> You can still answer and fire torpedoes; your score can't rise unless a Salvage lifts you.</span>
                  ) : (
                    <>
                      <span>{mine && mine.rate > 0 ? 'Sinking' : mine && mine.rate < 0 ? 'Rising' : 'Holding'} <b>{score1(Math.abs(mine?.rate ?? 0))}/s</b></span>
                      <span>Rank <b>{rank}</b>/{d.board.length}</span>
                      <span>Patch <b>+{points(d.values.patch)}</b></span>
                      <span>Torpedo <b>−{points(d.values.torpedo)}</b></span>
                    </>
                  )}
                </div>
                {sinkMods.length > 0 && !sunk && (
                  <div className="row" style={{ marginTop: 12 }}>
                    {sinkMods.filter((m) => !m.label.startsWith('__')).map((m) => <span key={m.id} className="chip" style={{ background: 'rgba(255,255,255,.08)', color: 'var(--deep-ink)' }}><Icon name="wave" size={12} />{m.label} ×{m.factor}</span>)}
                  </div>
                )}
              </div>
            </section>
            {activeMods.length > 0 && (
              <div className="row">
                {activeMods.map((m) => <span key={m.id} className="chip chip-blue">{m.label}{m.team_id ? ` · ${m.team_id}` : ''}</span>)}
              </div>
            )}
            <div className="sonar-wrap">
              <div className="spread" style={{ padding: '2px 4px 8px' }}>
                <span className="eyebrow" style={{ color: 'var(--deep-ink-2)' }}>Depth sonar</span>
                <span className="eyebrow" style={{ color: 'var(--deep-ink-2)' }}>Centre = surface</span>
              </div>
              {d.round.config.show_board === false
                ? <p style={{ color: 'var(--deep-ink-2)', padding: 20, fontSize: 14 }}>The board is hidden this round: you only see your own depth.</p>
                : <Sonar blips={d.board.map((b) => ({ id: b.id, score: scoreAt(b, readAt.current), sunk: b.sunk }))} me={team} max={startScore} />}
            </div>
            {d.round.config.show_board !== false && (
              <div>
                <span className="eyebrow">Standings</span>
                <div className="board" style={{ marginTop: 6 }}>
                  {ranked.map((b, i) => (
                    <div key={b.id} className={`board-row ${b.id === team ? 'me' : ''}`}>
                      <span className="rank">{i + 1}</span>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span className="mono faint" style={{ fontSize: 12.5 }}>{b.id}</span> {b.name}</span>
                      {b.sunk ? <span className="chip chip-bad">Rock Bottom</span> : <span className="score"><LiveScore row={b} readAt={readAt.current} /></span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="eyebrow">What's happening</span>
              <div style={{ marginTop: 6 }}><Feed items={feed} names={names} me={team} tz={tz} /></div>
            </div>
          </aside>
        </div>
      </div>

      {spend && d.pending && (
        <SpendModal d={d} team={team} readAt={readAt.current} roundId={id} onClose={() => setSpend(false)} onDone={async () => { setSpend(false); await data.refresh(); }} />
      )}
      {banner && <EventBanner f={banner} onDone={() => setBanner(null)} />}
      {integ.warned !== null && <AwayNotice ms={integ.warned} onClose={integ.dismiss} />}
    </>
  );
}

function MysteryQuestion({ p, i, roundId, answer, live, pending, onCorrect, refresh }: {
  p: { id: string; number: number; body: string }; i: number; roundId: string;
  answer?: { correct: boolean; spent_as: string | null; target_id: string | null; by: string; at: string };
  live: boolean; pending: boolean; onCorrect: () => void; refresh: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [justMissed, setJustMissed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const submit = async () => {
    if (!value.trim()) return setError('Type an answer first.');
    if (!armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    setError('');
    try {
      const r = await call<{ correct: boolean }>('s_mystery_answer', { token: token(), round: roundId, problem: p.id, raw: value, norm: normalize(value) });
      if (r.correct) {
        toast(`#${p.number} is right. Choose what to do with your hit.`, 'good');
        onCorrect();
      } else {
        setJustMissed(true);
        refresh();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      if (err instanceof ApiError && (err.code === 'answered' || err.code === 'pending')) refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id={`q-${p.number}`} className={`problem mq ${answer ? (answer.correct ? 'mq-ok' : 'mq-no') : ''}`} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
      <div className="problem-n"><b>{p.number}</b></div>
      <div style={{ minWidth: 0 }}>
        <Rich text={p.body} />
        {answer ? (
          <div className={`mq-result ${justMissed ? 'shake-once' : ''}`}>
            {answer.correct ? (
              <span className="chip chip-good"><Icon name="check" size={12} />Right</span>
            ) : (
              <span className="chip chip-bad"><Icon name="x" size={12} />Missed</span>
            )}
            <span className="muted" style={{ fontSize: 14 }}>
              {answer.correct
                ? answer.spent_as === 'patch' ? 'Spent on a hull patch.' : answer.spent_as === 'torpedo' ? `Spent on a torpedo at Team ${answer.target_id}.` : answer.spent_as === 'discard' ? 'Let go.' : 'Hit not used yet.'
                : 'No more tries on this one for your team.'}
            </span>
            <span className="faint" style={{ fontSize: 12.5 }}>· {answer.by}</span>
          </div>
        ) : (
          <form className="answer-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <input className="input input-lg answer mono" value={value} disabled={!live || busy} aria-label={`Answer to question ${p.number}`}
              placeholder={live ? 'Your team\'s answer' : ''} autoComplete="off" spellCheck={false}
              onChange={(e) => { setValue(e.target.value); setArmed(false); setError(''); }} />
            <button type="submit" className={`btn ${armed ? 'btn-accent armed' : 'btn-primary'}`} disabled={!live || busy || pending || !value.trim()}>
              {busy ? <><Spinner />Checking</> : armed ? 'Sure? Submit · one try' : 'Submit'}
            </button>
            {pending && live && <span className="faint" style={{ fontSize: 12.5 }}>Use your hit first</span>}
          </form>
        )}
        {error && <div className="banner banner-bad" style={{ marginTop: 10 }}><Icon name="alert" /><div>{error}</div></div>}
      </div>
    </section>
  );
}

function SpendModal({ d, team, readAt, roundId, onClose, onDone }: { d: MysteryData; team: string; readAt: number; roundId: string; onClose: () => void; onDone: () => void }) {
  const mine = d.board.find((b) => b.id === team);
  const sunk = !!mine?.sunk;
  const [choice, setChoice] = useState<'patch' | 'torpedo'>(sunk ? 'torpedo' : 'patch');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const allowSunk = !!d.round.config.allow_hit_sunk;
  const t = serverNow();
  const targets = d.board.filter((b) => b.id !== team).sort((a, b) => scoreAt(b, readAt, t) - scoreAt(a, readAt, t));
  const anyTarget = targets.some((b) => allowSunk || !b.sunk);

  const go_ = async (action: 'patch' | 'torpedo' | 'discard') => {
    setBusy(true);
    setError('');
    try {
      const r = await call<{ action: string; target: string | null; value: number }>('s_mystery_spend', { token: token(), round: roundId, action, target: action === 'torpedo' ? target : undefined });
      if (r.action === 'patch') toast(`Hull patched · +${points(r.value)}`, 'good');
      else if (r.action === 'torpedo') toast(`Torpedo away · Team ${r.target} −${points(r.value)}`, 'good');
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal onClose={() => !busy && onClose()} label="Use your hit" wide>
      <div className="modal-body stack" style={{ gap: 18 }}>
        <div>
          <span className="chip chip-good pop"><Icon name="check" size={12} />Hit ready</span>
          <h2 style={{ marginTop: 12 }}>Patch your hull, or fire at another team?</h2>
        </div>
        <div className="choice">
          <button className={`choice-btn patch ${choice === 'patch' ? 'on' : ''}`} disabled={sunk} onClick={() => setChoice('patch')} aria-pressed={choice === 'patch'}>
            <span className="row"><Icon name="wrench" size={18} /><b>Patch your hull</b></span>
            <span className="big" style={{ color: 'var(--good)' }}>+{points(d.values.patch)}</span>
            <span className="muted" style={{ fontSize: 13.5 }}>{sunk ? 'Not at Rock Bottom: your score can\'t rise.' : 'Raises your submarine. Keeps you off the sea floor.'}</span>
          </button>
          <button className={`choice-btn torpedo ${choice === 'torpedo' ? 'on' : ''}`} onClick={() => setChoice('torpedo')} aria-pressed={choice === 'torpedo'}>
            <span className="row"><Icon name="torpedo" size={18} /><b>Fire a torpedo</b></span>
            <span className="big" style={{ color: 'var(--accent-ink)' }}>−{points(d.values.torpedo)}</span>
            <span className="muted" style={{ fontSize: 13.5 }}>Knocks another team down. Everyone sees who fired.</span>
          </button>
        </div>
        {choice === 'torpedo' && (
          <div>
            <span className="eyebrow">Target</span>
            <div className="targets" role="listbox" aria-label="Choose a team to torpedo">
              {targets.map((b) => {
                const off = b.sunk && !allowSunk;
                return (
                  <button key={b.id} role="option" aria-selected={target === b.id} className={`target ${target === b.id ? 'on' : ''}`} disabled={off} onClick={() => setTarget(b.id)}>
                    <span className="mono" style={{ fontWeight: 500 }}>{b.id}</span>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                    {b.sunk ? <span className="chip chip-bad">Rock Bottom</span> : <span className="mono">{score1(scoreAt(b, readAt))}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {error && <div className="banner banner-bad"><Icon name="alert" /><div>{error}</div></div>}
      </div>
      <div className="modal-foot">
        {sunk && !anyTarget ? (
          <Button variant="primary" busy={busy} onClick={() => go_('discard')}>Nothing to aim at · let it go</Button>
        ) : choice === 'patch' ? (
          <Button variant="good" busy={busy} disabled={sunk} onClick={() => go_('patch')}>Patch hull · +{points(d.values.patch)}</Button>
        ) : (
          <Button variant="accent" busy={busy} disabled={!target} onClick={() => go_('torpedo')}>{target ? `Fire at ${target} · −${points(d.values.torpedo)}` : 'Pick a target'}</Button>
        )}
      </div>
    </Modal>
  );
}
