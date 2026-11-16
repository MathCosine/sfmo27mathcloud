import { useState } from 'react';
import { ApiError, call, serverNow } from '../../lib/api';
import { clock, fromLocalInput, ms, timeOf, toLocalInput, ago } from '../../lib/format';
import { go, toast, useTick } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, Confirm, Modal, Seg } from '../../ui/kit';
import { useStaff, type StaffRound } from './StaffApp';

const KIND: Record<string, string> = { individual: 'Individual', guts: 'Guts', mystery: 'Mystery Dive' };

export async function control(id: string, action: string, extra: object = {}) {
  try {
    await call('st_round_control', { id, action, ...extra });
    return true;
  } catch (e) {
    toast(e instanceof ApiError ? e.message : String(e), 'bad');
    return false;
  }
}

export function StateChip({ r }: { r: StaffRound }) {
  useTick(1000);
  const left = ms(r.closes_at) - serverNow();
  if (r.state === 'open') return <span className="chip chip-live"><span className="dot dot-live" />Live · {clock(left)}</span>;
  if (r.state === 'paused') return <span className="chip chip-warn"><Icon name="pause" size={12} />Paused</span>;
  if (r.state === 'closed') return <span className="chip chip-good"><Icon name="check" size={12} />Closed</span>;
  if (r.opens_at) return <span className="chip chip-blue">Starts in {clock(ms(r.opens_at) - serverNow())}</span>;
  return <span className="chip">Not started</span>;
}

/** Every control a round has, for its current state. */
export function RoundControls({ r, size = 'sm' }: { r: StaffRound; size?: 'sm' | 'md' }) {
  const { refresh, admin, tz } = useStaff();
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<'start' | 'close' | 'reset' | 'schedule' | 'reopen' | null>(null);
  const run = async (action: string, extra: object = {}, msg?: string) => {
    setBusy(action);
    const ok = await control(r.id, action, extra);
    setBusy('');
    if (ok) {
      if (msg) toast(msg, 'good');
      await refresh();
    }
  };
  return (
    <div className="row" style={{ gap: 6 }}>
      {r.state === 'waiting' && (
        <>
          <Button size={size} variant="accent" icon="play" busy={busy === 'start'} onClick={() => setAsk('start')}>Start now</Button>
          <Button size={size} icon="clock" onClick={() => setAsk('schedule')}>{r.opens_at ? 'Reschedule' : 'Schedule'}</Button>
          {r.opens_at && <Button size={size} variant="ghost" busy={busy === 'unschedule'} onClick={() => run('unschedule', {}, 'Unscheduled.')}>Unschedule</Button>}
        </>
      )}
      {r.state === 'open' && (
        <>
          <Button size={size} icon="pause" busy={busy === 'pause'} onClick={() => run('pause', {}, `${r.title} paused.`)}>Pause</Button>
          <Button size={size} icon="plus" busy={busy === 'extend'} onClick={() => run('extend', { minutes: 5 }, '5 minutes added.')}>5 min</Button>
          <Button size={size} icon="minus" variant="ghost" onClick={() => run('extend', { minutes: -1 }, 'Took a minute off.')} aria-label="Take a minute off" />
          <Button size={size} icon="stop" onClick={() => setAsk('close')}>Close</Button>
        </>
      )}
      {r.state === 'paused' && (
        <>
          <Button size={size} variant="accent" icon="play" busy={busy === 'resume'} onClick={() => run('resume', {}, `${r.title} resumed.`)}>Resume</Button>
          <Button size={size} icon="stop" onClick={() => setAsk('close')}>Close</Button>
        </>
      )}
      {r.state === 'closed' && (
        <>
          <Button size={size} icon="chart" onClick={() => go(`staff-results-${r.id}`)}>Results</Button>
          <Button size={size} icon="play" onClick={() => setAsk('reopen')}>Reopen</Button>
        </>
      )}
      {admin && r.state !== 'waiting' && <Button size={size} variant="ghost" icon="refresh" onClick={() => setAsk('reset')}>Reset</Button>}

      {ask === 'start' && (
        <Confirm title={`Start ${r.title} now?`} action="Start the round" onClose={() => setAsk(null)}
          body={<>Everyone gets the problems at once and the clock starts: {r.minutes} minutes{r.problem_count ? `, ${r.problem_count} problems` : ''}.{r.keys_missing > 0 && <><br /><b style={{ color: 'var(--bad)' }}>{r.keys_missing} problems have no answer key.</b></>}</>}
          onConfirm={() => run('start', {}, `${r.title} is live.`)} />
      )}
      {ask === 'close' && (
        <Confirm title={`Close ${r.title} now?`} action="Close it" danger onClose={() => setAsk(null)}
          body="Students stop being able to change answers straight away. You can reopen it afterwards if you need to."
          onConfirm={() => run('close', {}, `${r.title} closed.`)} />
      )}
      {ask === 'reset' && (
        <Confirm title={`Reset ${r.title}?`} action="Reset the round" danger word="RESET" onClose={() => setAsk(null)}
          body={<>This deletes every answer{r.kind === 'mystery' ? ', hit, torpedo and event' : r.kind === 'guts' ? ' and handed-in set' : ''} in this round and puts it back to not started. Problems and settings stay.</>}
          onConfirm={() => run('reset', {}, `${r.title} reset.`)} />
      )}
      {ask === 'schedule' && <ScheduleModal r={r} tz={tz} onClose={() => setAsk(null)} onSave={(at) => run('schedule', { at }, `Scheduled for ${timeOf(at, tz)}.`)} />}
      {ask === 'reopen' && <ReopenModal r={r} onClose={() => setAsk(null)} onSave={(minutes) => run('reopen', { minutes }, `Reopened for ${minutes} minutes.`)} />}
    </div>
  );
}

function ScheduleModal({ r, tz, onClose, onSave }: { r: StaffRound; tz: string; onClose: () => void; onSave: (iso: string) => void }) {
  const [v, setV] = useState(toLocalInput(r.opens_at ?? r.scheduled_at ?? new Date(serverNow() + 10 * 60_000).toISOString(), tz));
  return (
    <Modal onClose={onClose} label="Schedule">
      <div className="modal-body stack" style={{ gap: 14 }}>
        <h2>Schedule {r.title}</h2>
        <p className="muted">It opens by itself at this time ({tz.replace('_', ' ')}) and runs for {r.minutes} minutes.</p>
        <div className="field"><label htmlFor="sch">Opens at</label><input id="sch" className="input mono" type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} /></div>
      </div>
      <div className="modal-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { const iso = fromLocalInput(v, tz); if (iso) { onSave(iso); onClose(); } }}>Schedule</Button>
      </div>
    </Modal>
  );
}

function ReopenModal({ r, onClose, onSave }: { r: StaffRound; onClose: () => void; onSave: (minutes: number) => void }) {
  const [m, setM] = useState('5');
  return (
    <Modal onClose={onClose} label="Reopen">
      <div className="modal-body stack" style={{ gap: 14 }}>
        <h2>Reopen {r.title}</h2>
        <p className="muted">For a contest-wide problem, like a Zoom outage. Answers already in stay; students can change them again until the new time runs out.{r.kind === 'mystery' ? ' Nobody sinks for the time it was closed.' : ''}</p>
        <div className="field"><label htmlFor="ro">Minutes</label><input id="ro" className="input mono" type="number" min={1} max={120} value={m} onChange={(e) => setM(e.target.value)} /></div>
      </div>
      <div className="modal-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { const n = Number(m); if (n > 0) { onSave(n); onClose(); } }}>Reopen</Button>
      </div>
    </Modal>
  );
}

export function ControlRoom() {
  const { s, refresh, tz } = useStaff();
  const [text, setText] = useState('');
  const [tone, setTone] = useState<'info' | 'urgent'>('info');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const live = s.rounds.filter((r) => r.state === 'open' || r.state === 'paused');

  const announce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await call('st_announce', { text, tone, round: scope || null });
      setText('');
      toast('Sent to every screen.', 'good');
      await refresh();
    } catch (x) {
      toast(x instanceof ApiError ? x.message : String(x), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <div>
          <span className="label-sm">{s.settings.event_name} · {s.settings.event_subtitle}</span>
          <h1>{live.length === 0 ? 'Control room' : live.length === 1 ? `${live[0].title} is live` : live.length === 2 ? `${live[0].title} and ${live[1].title} are live` : `${live.length} rounds are live`}</h1>
          <p>
            <b className="mono">{s.counts.online}</b> of {s.counts.students} students online · <b className="mono">{s.counts.signed_in}</b> signed in today · {s.counts.teams} teams
            {s.counts.flags ? <> · <a className="linkish" href="#staff-integrity">{s.counts.flags} flags in 15 min</a></> : ''}
            {s.counts.held ? <> · <a className="linkish" href="#staff-proctor">{s.counts.held} on hold</a></> : ''}
          </p>
        </div>
        <div className="row">
          <a className="btn btn-sm" href="#staff-proctor"><Icon name="eye" size={15} />Proctoring</a>
          <a className="btn btn-sm" href="#board-mystery" target="_blank" rel="noreferrer"><Icon name="monitor" size={15} />Mystery board</a>
          <a className="btn btn-sm" href="#board-guts" target="_blank" rel="noreferrer"><Icon name="monitor" size={15} />Guts board</a>
        </div>
      </header>


      <div className="spread" style={{ marginBottom: 12 }}>
        <h2>Rounds</h2>
        <button className="linkish" style={{ fontSize: 14 }} onClick={() => go('staff-rounds')}>Edit rounds and problems</button>
      </div>
      <div className="stack" style={{ gap: 10, marginBottom: 34 }}>
        {s.rounds.map((r) => (
          <div key={r.id} className={`round-card ${r.state === 'open' ? 'live' : ''}`}>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 10 }}>
                <h3 style={{ fontSize: 19 }}>{r.title}</h3>
                <StateChip r={r} />
                {!r.visible && <span className="chip chip-outline">Hidden</span>}
              </div>
              <div className="faint" style={{ fontSize: 13.5, marginTop: 5 }}>
                {KIND[r.kind]} · {r.minutes} min · {r.problem_count} problems
                {r.opens_at ? ` · opened ${timeOf(r.opens_at, tz)}` : r.scheduled_at ? ` · planned ${timeOf(r.scheduled_at, tz)}` : ''}
                {r.entrants ? ` · ${r.entrants} ${r.kind === 'individual' ? 'students' : 'teams'} answering` : ''}
                {r.keys_missing ? <span style={{ color: 'var(--bad)' }}> · {r.keys_missing} without a key</span> : ''}
              </div>
            </div>
            <RoundControls r={r} />
          </div>
        ))}
      </div>

      <div className="home-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <form className="panel panel-pad stack" style={{ gap: 12 }} onSubmit={announce}>
          <div className="spread"><h3>Announce</h3><Seg label="Tone" value={tone} onChange={setTone} options={[['info', 'Note'], ['urgent', 'Urgent']]} /></div>
          <textarea id="ann" className="textarea" placeholder="Problem 11: x is a real number." value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} aria-label="Announcement" />
          <div className="spread">
            <select className="select" style={{ width: 'auto', height: 36 }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Who sees it">
              <option value="">Everyone, everywhere</option>
              {s.rounds.map((r) => <option key={r.id} value={r.id}>Only in {r.title}</option>)}
            </select>
            <Button type="submit" variant="primary" icon="megaphone" busy={busy} disabled={!text.trim()}>Send</Button>
          </div>
        </form>
        <div className="panel">
          <div className="panel-head"><h3>Sent</h3><span className="faint" style={{ fontSize: 13 }}>{s.announcements.length}</span></div>
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {s.announcements.length === 0 && <p className="faint" style={{ padding: 20 }}>Nothing sent yet. Announcements show as a banner on every student's screen.</p>}
            {s.announcements.map((a) => (
              <div key={a.id} className="spread" style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>{a.tone === 'urgent' && <span className="chip chip-live" style={{ marginRight: 6 }}>Urgent</span>}{a.text}</div>
                  <div className="faint" style={{ fontSize: 12.5, marginTop: 3 }}>{a.by} · {ago(a.at)}{a.round_id ? ` · ${a.round_id}` : ''}</div>
                </div>
                <Button size="xs" variant="ghost" icon="trash" aria-label="Delete announcement" onClick={async () => { await call('st_announce', { action: 'delete', id: a.id }); refresh(); }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
