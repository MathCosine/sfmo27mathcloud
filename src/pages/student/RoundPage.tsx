import { useEffect, useMemo, useRef, useState } from 'react';
import { call, serverNow, useStore } from '../../lib/api';
import { looksMathy, answerToTex } from '../../lib/answers';
import { ago, clock, DEFAULT_TZ, ms, points, timeOf } from '../../lib/format';
import { go, storageGet, storageSet, toast, usePoll, useTick } from '../../lib/hooks';
import { flushSoon, outboxSummary, pendingFor, putAnswer, useBoxes } from '../../lib/outbox';
import { token, useStudent } from '../../lib/session';
import { Icon } from '../../ui/icons';
import { Button, Check, ErrorNote, Modal, PageLoading, Rich, Spinner, Tex } from '../../ui/kit';
import { Announcements, homeCache, type Announcement, type RoundInfo } from './StudentApp';
import { MysteryRound } from './MysteryRound';

type Problem = { id: string; number: number; set_no: number; points: number; body: string; answer?: string; correct?: boolean };
type Resp = { raw: string; by: string; at: string };
export type RoundData = {
  now: string;
  round: RoundInfo;
  problems: Problem[];
  responses: Record<string, Resp>;
  sets_done: number;
  score: number | null;
  board: { id: string; name: string; score: number; sets: number }[] | null;
  announcements: Announcement[];
};

export function RoundPage({ id }: { id: string }) {
  const home = useStore(homeCache);
  if (!home) return <div className="wrap"><PageLoading /></div>;
  const r = home.rounds.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="wrap page empty">
        <h3>That round isn't here.</h3>
        <p>It may have been renamed or hidden. <button className="linkish" onClick={() => go('')}>Back to today</button></p>
      </div>
    );
  }
  return r.kind === 'mystery' ? <MysteryRound id={id} /> : <TestRound id={id} kind={r.kind} />;
}

// ---------------------------------------------------------------- shared pieces

export function useIntegrity(roundId: string, active: boolean, policy: string) {
  const [warned, setWarned] = useState<number | null>(null);
  useEffect(() => {
    if (!active || policy === 'off') return;
    let awayAt = 0;
    let hidden = false;
    const leave = () => {
      if (!awayAt) awayAt = Date.now();
      if (document.hidden) hidden = true;
    };
    const back = () => {
      if (!awayAt || document.hidden || !document.hasFocus()) return;
      const away = Date.now() - awayAt;
      const kind = hidden ? 'hidden' : 'blur';
      awayAt = 0;
      hidden = false;
      if (kind === 'blur' && away < 2000) return;
      call('s_flag', { token: token(), round: roundId, kind, ms: away }).catch(() => {});
      if (policy === 'warn') setWarned(away);
    };
    const onVis = () => (document.hidden ? leave() : back());
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [roundId, active, policy]);
  return { warned, dismiss: () => setWarned(null) };
}

export function AwayNotice({ ms: away, onClose }: { ms: number; onClose: () => void }) {
  return (
    <Modal onClose={onClose} label="You left the test">
      <div className="modal-body stack" style={{ gap: 12 }}>
        <span className="chip chip-bad" style={{ alignSelf: 'flex-start' }}><Icon name="eye" size={13} />Recorded</span>
        <h2>You left the test for {Math.max(1, Math.round(away / 1000))} s.</h2>
        <p className="muted">Your proctor can see when this tab is in the background. Stay on this page until the round ends; if something on your computer pulled you away, tell your proctor in Zoom.</p>
      </div>
      <div className="modal-foot"><Button variant="primary" onClick={onClose}>Back to the test</Button></div>
    </Modal>
  );
}

export function RoundClock({ round, compact = false }: { round: RoundInfo; compact?: boolean }) {
  useTick(250);
  const now = serverNow();
  const closes = ms(round.closes_at);
  const opens = ms(round.opens_at);
  if (round.state === 'paused') return <div className="clock" style={{ color: 'var(--warn)' }} aria-live="polite">Paused</div>;
  if (!Number.isFinite(closes) || round.state !== 'open') return null;
  const left = closes - now;
  const total = Math.max(1, closes - opens);
  const cls = left < 60_000 ? 'clock-final' : left < 5 * 60_000 ? 'clock-low' : '';
  return (
    <div style={{ minWidth: compact ? 0 : 130 }}>
      <div className={`clock ${cls}`} role="timer" aria-label={`${clock(left)} left`}>{clock(left)}</div>
      {!compact && (
        <div className={`clock-bar ${left < 5 * 60_000 ? 'low' : ''}`} style={{ marginTop: 7 }} aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, (left / total) * 100))}%` }} />
        </div>
      )}
    </div>
  );
}

function SaveSummary({ round }: { round: string }) {
  const boxes = useBoxes();
  useTick(5000);
  const s = outboxSummary(boxes, round);
  if (s.waiting) return <span className="save-state waiting" style={{ color: 'var(--warn)' }}><Icon name="signal" size={15} />{s.waiting} waiting for connection</span>;
  if (s.saving) return <span className="save-state"><Spinner size={14} />Saving…</span>;
  if (s.last) return <span className="save-state"><Icon name="check" size={15} />All answers saved</span>;
  return <span className="save-state">Answers save as you type</span>;
}

export function WaitingRoom({ round, tz }: { round: RoundInfo; tz: string }) {
  useTick(500);
  const opens = ms(round.opens_at);
  const left = opens - serverNow();
  return (
    <div className="wrap wrap-narrow page" style={{ textAlign: 'left' }}>
      <button className="btn btn-ghost btn-sm" style={{ marginLeft: -12, marginBottom: 18 }} onClick={() => go('')}><Icon name="back" size={16} />Today</button>
      <p className="eyebrow" style={{ marginBottom: 12 }}>{round.kind === 'individual' ? 'Individual round' : 'Team round'} · {round.minutes} minutes</p>
      <h1>{round.title}</h1>
      <div className="panel panel-pad" style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <div className="grow">
          <span className="eyebrow">{Number.isFinite(opens) ? 'Starts in' : 'Waiting to start'}</span>
          <div className="clock" style={{ fontSize: 44, marginTop: 6 }}>{Number.isFinite(opens) ? clock(left) : '— : —'}</div>
          <p className="faint" style={{ fontSize: 13.5, marginTop: 6 }}>
            {Number.isFinite(opens) ? `At ${timeOf(round.opens_at, tz)}. This page opens the round by itself.` : 'Your proctor starts the round. Keep this page open; it opens by itself.'}
          </p>
        </div>
        <div className="ticks" style={{ width: 120 }} />
      </div>
      <h3 style={{ marginTop: 34, marginBottom: 10 }}>Rules</h3>
      <Rich text={round.rules} className="muted" />
    </div>
  );
}

// ---------------------------------------------------------------- individual & guts

function TestRound({ id, kind }: { id: string; kind: 'individual' | 'guts' }) {
  const me = useStudent()!;
  const home = useStore(homeCache);
  const tz = home?.settings.timezone || DEFAULT_TZ;
  const policy = home?.settings.integrity || 'warn';
  const [ann, setAnn] = useState<Announcement[]>([]);
  const annSince = useRef(0);

  const data = usePoll(async () => {
    const d = await call<RoundData>('s_round', { token: token(), round: id, ann_since: annSince.current });
    if (d.announcements.length) {
      annSince.current = Math.max(annSince.current, ...d.announcements.map((a) => a.id));
      setAnn((prev) => [...d.announcements, ...prev].slice(0, 6));
    }
    return d;
  }, kind === 'guts' ? 4000 : 15000, [id]);

  // Poll quickly around the start so the round appears the moment it opens.
  const d = data.data;
  const state = d?.round.state;
  useEffect(() => {
    if (state !== 'waiting' || !d?.round.opens_at) return;
    const left = ms(d.round.opens_at) - serverNow();
    const t = setTimeout(data.refresh, Math.max(300, Math.min(left + 150, 15000)));
    return () => clearTimeout(t);
  }, [state, d, data.refresh]);

  const integ = useIntegrity(id, state === 'open', policy);

  if (!d) return <div className="wrap">{data.error ? <div className="page"><ErrorNote error={data.error} onRetry={data.refresh} /></div> : <PageLoading />}</div>;
  if (d.round.state === 'waiting') return <WaitingRoom round={d.round} tz={tz} />;
  if (d.round.state === 'closed') return <ClosedRound d={d} />;

  return (
    <>
      <div className="testbar">
        <div className="wrap testbar-in">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={() => go('')} aria-label="Back to today"><Icon name="back" /></button>
          <div className="grow">
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, letterSpacing: '-0.02em' }}>{d.round.title}</div>
            <SaveSummary round={id} />
          </div>
          <RoundClock round={d.round} />
        </div>
      </div>
      <div className="wrap page" style={{ paddingTop: 24 }}>
        {(ann.length > 0 || d.round.state === 'paused') && (
          <div className="stack" style={{ gap: 8, marginBottom: 20 }}>
            {d.round.state === 'paused' && (
              <div className="banner banner-urgent"><Icon name="pause" /><div>The round is paused by the proctors. Your answers are safe, and the clock will resume with the time you had left.</div></div>
            )}
            <Announcements items={ann} />
          </div>
        )}
        {kind === 'individual' ? <IndividualBody d={d} /> : <GutsBody d={d} meTeam={me.student.team_id} refresh={data.refresh} />}
      </div>
      {integ.warned !== null && <AwayNotice ms={integ.warned} onClose={integ.dismiss} />}
    </>
  );
}

function AnswerBox({ round, problem, server, locked, meId, label }: { round: string; problem: string; server?: Resp; locked?: boolean; meId: string; label: string }) {
  const boxes = useBoxes();
  const key = `${round}:${problem}`;
  const state = boxes[key];
  const [value, setValue] = useState(() => pendingFor(round, problem) ?? server?.raw ?? '');
  const focused = useRef(false);
  // A teammate's newer answer replaces ours unless we're typing in this box.
  useEffect(() => {
    if (focused.current || pendingFor(round, problem) !== undefined) return;
    setValue(server?.raw ?? '');
  }, [server?.raw, server?.at, round, problem]);
  const preview = looksMathy(value);
  const byOther = server && server.by && server.by !== meId && server.raw === value;
  return (
    <div>
      <div className="answer-row">
        <input
          className="input input-lg answer mono"
          value={value}
          disabled={locked}
          aria-label={label}
          placeholder={locked ? '' : 'Your answer'}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            flushSoon();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              flushSoon();
              (e.target as HTMLInputElement).blur();
            }
          }}
          onChange={(e) => {
            setValue(e.target.value);
            putAnswer(round, problem, e.target.value);
          }}
        />
        <BoxState state={state?.state} at={state?.at} message={state?.message} />
      </div>
      {(preview || byOther) && (
        <div className="answer-preview" style={{ marginTop: 8 }}>
          {preview && <><span className="faint" style={{ fontSize: 12.5 }}>Reads as</span><Tex src={answerToTex(value)} /></>}
          {byOther && <span className="typed-by">· typed by {server!.by} {ago(server!.at)}</span>}
        </div>
      )}
    </div>
  );
}

function BoxState({ state, at, message }: { state?: string; at?: number; message?: string }) {
  useTick(10000);
  if (!state) return <span className="box-state" />;
  if (state === 'typing' || state === 'saving') return <span className="box-state"><Spinner size={13} />Saving</span>;
  if (state === 'waiting') return <span className="box-state waiting"><Icon name="signal" size={14} />Will send</span>;
  if (state === 'error') return <span className="box-state error" title={message}><Icon name="alert" size={14} />Not saved</span>;
  return <span className="box-state saved" key={at}><Check size={14} />Saved{at && Date.now() - at > 60_000 ? ` ${ago(at)}` : ''}</span>;
}

function IndividualBody({ d }: { d: RoundData }) {
  const me = useStudent()!;
  const boxes = useBoxes();
  const flagKey = `sfmo27-flags-${me.student.id}-${d.round.id}`;
  const [flags, setFlags] = useState<string[]>(() => storageGet(flagKey, []));
  const toggle = (pid: string) => {
    const next = flags.includes(pid) ? flags.filter((x) => x !== pid) : [...flags, pid];
    setFlags(next);
    storageSet(flagKey, next);
  };
  const answered = (pid: string) => {
    const pending = pendingFor(d.round.id, pid);
    return pending !== undefined ? pending.trim() !== '' : !!d.responses[pid]?.raw;
  };
  void boxes;
  const count = d.problems.filter((p) => answered(p.id)).length;
  return (
    <div className="test-grid">
      <nav aria-label="Problems">
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Problems</span>
          <span className="mono faint" style={{ fontSize: 12.5 }}>{count}/{d.problems.length}</span>
        </div>
        <div className="navgrid">
          {d.problems.map((p) => (
            <button key={p.id} className={`navcell ${answered(p.id) ? 'done' : ''} ${flags.includes(p.id) ? 'flag' : ''}`}
              onClick={() => document.getElementById(`p-${p.number}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              aria-label={`Problem ${p.number}${answered(p.id) ? ', answered' : ''}${flags.includes(p.id) ? ', flagged' : ''}`}>
              {p.number}
            </button>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 14 }}>Flag a problem to come back to it. Flags stay on this device.</p>
      </nav>
      <div style={{ minWidth: 0 }}>
        <div className="rules-intro">
          <Rich text={d.round.rules} className="muted" />
        </div>
        {d.problems.map((p, i) => (
          <section key={p.id} id={`p-${p.number}`} className="problem" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
            <div className="problem-n"><b>{p.number}</b>{p.points !== 1 ? `${points(p.points)} pts` : ''}</div>
            <div style={{ minWidth: 0 }}>
              <Rich text={p.body} />
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="grow"><AnswerBox round={d.round.id} problem={p.id} server={d.responses[p.id]} meId={me.student.id} label={`Answer to problem ${p.number}`} /></div>
                <button className={`btn btn-ghost btn-sm flag-btn ${flags.includes(p.id) ? 'on' : ''}`} style={{ marginTop: 22 }} onClick={() => toggle(p.id)} aria-pressed={flags.includes(p.id)}>
                  <Icon name="flag" size={15} />{flags.includes(p.id) ? 'Flagged' : 'Flag'}
                </button>
              </div>
            </div>
          </section>
        ))}
        <div className="sunk" style={{ marginTop: 28, padding: '20px 22px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <Icon name="check" size={20} />
          <div className="grow">
            <b>That's every problem.</b>
            <div className="muted" style={{ fontSize: 14 }}>There's nothing to hand in: whatever is in the boxes when time runs out is your answer.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GutsBody({ d, meTeam, refresh }: { d: RoundData; meTeam: string; refresh: () => Promise<void> }) {
  const me = useStudent()!;
  const [confirm, setConfirm] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [busy, setBusy] = useState(false);
  const sets = useMemo(() => {
    const by = new Map<number, Problem[]>();
    for (const p of d.problems) by.set(p.set_no, [...(by.get(p.set_no) ?? []), p]);
    return by;
  }, [d.problems]);
  const total = d.round.set_count;
  const current = d.sets_done + 1;
  const cur = sets.get(current) ?? [];
  const allDone = d.sets_done >= total;
  const filled = cur.filter((p) => (pendingFor(d.round.id, p.id) ?? d.responses[p.id]?.raw ?? '').trim()).length;

  const handIn = async () => {
    setBusy(true);
    flushSoon();
    try {
      await new Promise((r) => setTimeout(r, 350));
      const r = await call<{ set: number; correct?: number; points?: number; already?: boolean }>('s_guts_submit', { token: token(), round: d.round.id, set: current });
      setConfirm(false);
      setSealing(true);
      if (r.already) toast(`A teammate already handed in set ${r.set}.`);
      else toast(r.correct !== undefined ? `Set ${r.set} handed in · ${r.correct} of ${cur.length} right · +${points(r.points ?? 0)}` : `Set ${r.set} handed in.`, 'good');
      setTimeout(() => setSealing(false), 480);
      await refresh();
    } catch (e: any) {
      toast(e.message, 'bad');
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guts-grid">
      <div className="guts-rail">
        <span className="eyebrow">Sets</span>
        <div className="sets" style={{ marginTop: 8 }}>
          {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
            const ps = sets.get(n);
            const pts = ps?.[0]?.points;
            const st = n <= d.sets_done ? 'done' : n === current ? 'now' : '';
            return (
              <div key={n} className={`set-step ${st}`}>
                <span className="bead">{st === 'done' ? <Icon name="check" size={12} strokeWidth={2.2} /> : n}</span>
                <span>Set {n}</span>
                <span className="mono" style={{ fontSize: 12 }}>{pts ? `${points(pts)} pts` : <Icon name="lock" size={13} />}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {allDone ? (
          <div className="set-card" style={{ padding: 30 }}>
            <span className="chip chip-good"><Icon name="check" size={12} />All {total} sets in</span>
            <h2 style={{ marginTop: 14 }}>Your team has handed in every set.</h2>
            <p className="muted" style={{ marginTop: 8 }}>Keep an eye on the board until time runs out.</p>
          </div>
        ) : (
          <div key={current} className={`set-card ${sealing ? 'sealing' : ''}`}>
            <div className="set-head">
              <div>
                <span className="eyebrow">Set {current} of {total}</span>
                <h2 style={{ marginTop: 4 }}>{cur.length} problems · {points(cur[0]?.points ?? 0)} points each</h2>
              </div>
              <span className="faint" style={{ fontSize: 13 }}>Shared with your team · {filled}/{cur.length} filled</span>
            </div>
            {cur.map((p) => (
              <section key={p.id} className="problem" style={{ gridTemplateColumns: '44px minmax(0,1fr)' }}>
                <div className="problem-n"><b style={{ fontSize: 22 }}>{p.number}</b></div>
                <div style={{ minWidth: 0 }}>
                  <Rich text={p.body} />
                  <AnswerBox round={d.round.id} problem={p.id} server={d.responses[p.id]} meId={me.student.id} label={`Answer to problem ${p.number}`} />
                </div>
              </section>
            ))}
            <div className="spread" style={{ paddingTop: 20 }}>
              <span className="faint" style={{ fontSize: 13.5, maxWidth: 380 }}>Once your team hands in this set, nobody can change it and the next set opens.</span>
              <Button variant="primary" size="lg" arrow onClick={() => setConfirm(true)} disabled={d.round.state !== 'open'}>Hand in set {current}</Button>
            </div>
          </div>
        )}

        {d.sets_done > 0 && (
          <details className="done-sets">
            <summary>Handed in ({d.sets_done})</summary>
            {Array.from({ length: d.sets_done }, (_, i) => i + 1).map((n) => (
              <div key={n} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="eyebrow">Set {n}</span>
                <div className="row" style={{ marginTop: 6 }}>
                  {(sets.get(n) ?? []).map((p) => (
                    <span key={p.id} className="chip chip-outline mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{p.number}: {d.responses[p.id]?.raw || '—'}</span>
                  ))}
                </div>
              </div>
            ))}
          </details>
        )}
      </div>

      <aside>
        <div className="spread" style={{ marginBottom: 8 }}>
          <span className="eyebrow">Live board</span>
          <span className="chip chip-live"><span className="dot dot-live" />Live</span>
        </div>
        {d.board ? <GutsBoard rows={d.board} me={meTeam} /> : <p className="faint">The board is hidden for this round.</p>}
      </aside>

      {confirm && (
        <Modal onClose={() => !busy && setConfirm(false)} label={`Hand in set ${current}`}>
          <div className="modal-body stack" style={{ gap: 12 }}>
            <h2>Hand in set {current}?</h2>
            <p className="muted">This hands it in for your whole team. You can't change these answers afterwards{current < total ? `, and set ${current + 1} opens straight away` : ''}.</p>
            <div className="sunk" style={{ padding: '12px 16px' }}>
              {cur.map((p) => {
                const v = pendingFor(d.round.id, p.id) ?? d.responses[p.id]?.raw ?? '';
                return (
                  <div key={p.id} className="spread" style={{ padding: '4px 0' }}>
                    <span className="faint">Problem {p.number}</span>
                    <span className="mono">{v || <span className="faint">blank</span>}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="modal-foot">
            <Button onClick={() => setConfirm(false)} disabled={busy}>Keep working</Button>
            <Button variant="primary" busy={busy} onClick={handIn}>Hand in set {current}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function GutsBoard({ rows, me, limit = 12 }: { rows: { id: string; name: string; score: number; sets: number }[]; me: string; limit?: number }) {
  const prev = useRef<Record<string, number>>({});
  const changed = new Set(rows.filter((r) => prev.current[r.id] !== undefined && prev.current[r.id] !== r.score).map((r) => r.id));
  useEffect(() => {
    prev.current = Object.fromEntries(rows.map((r) => [r.id, r.score]));
  });
  const mine = rows.findIndex((r) => r.id === me);
  const shown = rows.slice(0, limit);
  return (
    <div className="board">
      {shown.map((r, i) => (
        <div key={r.id + (changed.has(r.id) ? r.score : '')} className={`board-row ${r.id === me ? 'me' : ''} ${changed.has(r.id) ? 'bump' : ''}`}>
          <span className="rank">{i + 1}</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span className="mono faint" style={{ fontSize: 12.5 }}>{r.id}</span> {r.name}</span>
          <span className="score">{points(r.score)}</span>
        </div>
      ))}
      {mine >= limit && (
        <div className="board-row me">
          <span className="rank">{mine + 1}</span>
          <span><span className="mono faint" style={{ fontSize: 12.5 }}>{rows[mine].id}</span> {rows[mine].name}</span>
          <span className="score">{points(rows[mine].score)}</span>
        </div>
      )}
    </div>
  );
}

function ClosedRound({ d }: { d: RoundData }) {
  const review = d.round.show_results && d.problems.length > 0;
  return (
    <div className="wrap wrap-narrow page">
      <button className="btn btn-ghost btn-sm" style={{ marginLeft: -12, marginBottom: 18 }} onClick={() => go('')}><Icon name="back" size={16} />Today</button>
      <span className="chip chip-good"><Icon name="check" size={12} />Round over</span>
      <h1 style={{ marginTop: 14 }}>{d.round.title} is finished.</h1>
      {review ? (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', marginTop: 24 }}>
            <div className="stat"><span className="eyebrow">Score</span><b>{points(d.score ?? 0)}</b></div>
            <div className="stat"><span className="eyebrow">Correct</span><b>{d.problems.filter((p) => p.correct).length}/{d.problems.length}</b></div>
          </div>
          <div style={{ marginTop: 24 }}>
            {d.problems.map((p) => (
              <section key={p.id} className="problem">
                <div className="problem-n"><b>{p.number}</b></div>
                <div style={{ minWidth: 0 }}>
                  <Rich text={p.body} />
                  <div className="row" style={{ marginTop: 12 }}>
                    <span className={`chip ${p.correct ? 'chip-good' : 'chip-bad'}`}>{p.correct ? 'Correct' : d.responses[p.id] ? 'Not this time' : 'Blank'}</span>
                    <span className="mono">Yours: {d.responses[p.id]?.raw || '—'}</span>
                    <span className="mono faint">Answer: {p.answer?.split('|')[0].trim()}</span>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 12 }}>Your answers are in. Scores come out after the contest.</p>
      )}
    </div>
  );
}
