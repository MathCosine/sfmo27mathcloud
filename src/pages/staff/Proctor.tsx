import { useMemo, useState } from 'react';
import { ApiError, call } from '../../lib/api';
import { ago } from '../../lib/format';
import { toast, usePoll } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, ErrorNote, Modal, PageLoading, Seg } from '../../ui/kit';

type Live = { id: string; title: string; kind: string; state: string; fullscreen: boolean; zoom_checkin: boolean };
type Student = {
  id: string; name: string; disabled: boolean; hold_reason: string | null; hold_at: string | null; devices: number; last_seen: string | null;
  live: { round: string | null; fullscreen: boolean | null; visible: boolean | null; at: string } | null;
  checkins: string[]; flags_recent: number; flags: number; last_flag: { kind: string; at: string; ms: number } | null;
};
type Team = { id: string; name: string; room_url: string; students: Student[] };
type Data = { now: string; live: Live[]; teams: Team[] };

const REASONS = ['turn your camera on in Zoom.', 'turn your microphone on in Zoom.', 'join your team\'s Zoom room.', 'show your desk on camera.', 'talk to your proctor in Zoom.'];
const FLAG_TEXT: Record<string, string> = { hidden: 'left the tab', blur: 'window lost focus', fullscreen_exit: 'left full screen', no_fullscreen: 'device can\'t go full screen', copy: 'tried to copy a problem' };

/** What needs a proctor's eye for one student, given the rounds that are live. */
function problems(s: Student, live: Live[]): string[] {
  const out: string[] = [];
  const online = s.devices > 0;
  if (s.hold_reason) out.push('On hold');
  if (live.length && !online) return [...out, 'Offline'];
  if (online && s.live) {
    const r = live.find((x) => x.id === s.live!.round);
    if (r?.fullscreen && s.live.fullscreen === false) out.push('Not full screen');
    if (s.live.visible === false) out.push('Tab hidden');
  }
  for (const r of live) if (r.zoom_checkin && !s.checkins.includes(r.id)) out.push(`Not checked in · ${r.title}`);
  if (s.flags_recent) out.push(`${s.flags_recent} flag${s.flags_recent > 1 ? 's' : ''} in 10 min`);
  return out;
}

export function Proctoring() {
  const data = usePoll(() => call<Data>('st_proctor'), 3000);
  const [view, setView] = useState<'attention' | 'all'>('attention');
  const [q, setQ] = useState('');
  const [hold, setHold] = useState<{ student?: Student; team?: Team } | null>(null);
  const d = data.data;
  const teams = useMemo(() => {
    if (!d) return [];
    const needle = q.trim().toLowerCase();
    return d.teams
      .map((t) => ({ ...t, students: t.students.map((s) => ({ s, issues: problems(s, d.live) })) }))
      .filter((t) => !needle || t.id.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle) || t.students.some(({ s }) => s.name.toLowerCase().includes(needle) || s.id.toLowerCase().includes(needle)))
      .filter((t) => view === 'all' || t.students.some((x) => x.issues.length));
  }, [d, view, q]);
  if (!d) return data.error ? <ErrorNote error={data.error} onRetry={data.refresh} /> : <PageLoading />;
  const everyone = d.teams.flatMap((t) => t.students);
  const attention = everyone.filter((s) => problems(s, d.live).length).length;
  const release = async (p: object, msg: string) => {
    try {
      await call('st_hold', { ...p, release: true });
      toast(msg, 'good');
      data.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    }
  };
  return (
    <>
      <header>
        <div>
          <p className="label-sm">Live</p>
          <h1>Proctoring</h1>
          <p>
            {d.live.length ? `${d.live.map((r) => r.title).join(', ')} ${d.live.length > 1 ? 'are' : 'is'} open. ` : 'No round is open. '}
            {attention ? `${attention} student${attention > 1 ? 's need' : ' needs'} a look.` : 'Nobody needs a look right now.'} Updates every 3 seconds.
          </p>
        </div>
      </header>
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ maxWidth: 360, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--ink-3)' }}><Icon name="search" size={16} /></span>
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Team, name or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a team or student" />
        </div>
        <Seg label="Show" value={view} onChange={setView} options={[['attention', `Needs a look · ${attention}`], ['all', 'Everyone']]} />
      </div>
      {d.live.some((r) => r.fullscreen) || d.live.some((r) => r.zoom_checkin) ? (
        <p className="faint" style={{ fontSize: 13, marginBottom: 14 }}>
          {d.live.filter((r) => r.fullscreen).map((r) => r.title).join(', ')}{d.live.some((r) => r.fullscreen) ? ' must be in full screen. ' : ''}
          {d.live.filter((r) => r.zoom_checkin).map((r) => r.title).join(', ')}{d.live.some((r) => r.zoom_checkin) ? ' need a Zoom check-in: compare it with what you see in the room.' : ''}
        </p>
      ) : null}
      {teams.length === 0 && <div className="panel empty"><h3>All clear.</h3><p>Everyone is where they should be.</p></div>}
      <div className="stack" style={{ gap: 10 }}>
        {teams.map((t) => {
          const held = t.students.some(({ s }) => s.hold_reason);
          return (
            <section key={t.id} className="panel">
              <div className="panel-head">
                <div className="row" style={{ gap: 10 }}>
                  <span className="mono">{t.id}</span><h3>{t.name}</h3>
                  {t.room_url && <a className="linkish" style={{ fontSize: 13 }} href={t.room_url} target="_blank" rel="noreferrer">Zoom room</a>}
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {held ? <Button size="xs" onClick={() => release({ team_id: t.id }, `Team ${t.id} released.`)}>Release team</Button> : <Button size="xs" icon="pause" onClick={() => setHold({ team: { id: t.id, name: t.name, room_url: t.room_url, students: [] } })}>Hold team</Button>}
                </div>
              </div>
              <div className="table-wrap">
                <table className="table" style={{ tableLayout: 'fixed', minWidth: 780 }}>
                  <colgroup><col style={{ width: '24%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /><col /><col style={{ width: 110 }} /></colgroup>
                  <tbody>
                    {t.students.map(({ s, issues }) => {
                      const online = s.devices > 0;
                      const where = s.live?.round ? d.live.find((r) => r.id === s.live!.round)?.title ?? s.live.round : online ? 'Home page' : '';
                      return (
                        <tr key={s.id} className={issues.length ? 'needs' : ''}>
                          <td><span className="mono faint">{s.id}</span> {s.name}</td>
                          <td>{online ? <span className="status ok"><i />Online{s.devices > 1 ? ` · ${s.devices} devices` : ''}</span> : <span className="status off"><i />{s.last_seen ? `Seen ${ago(s.last_seen)}` : 'Never signed in'}</span>}</td>
                          <td className="muted">{where}</td>
                          <td>
                            {issues.length ? (
                              <div className="row" style={{ gap: 6 }}>{issues.map((x) => <span key={x} className="tag tag-bad">{x}</span>)}</div>
                            ) : online ? <span className="faint">Fine</span> : null}
                            {s.hold_reason && <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>“{s.hold_reason}”</div>}
                            {s.last_flag && <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>Last flag: {FLAG_TEXT[s.last_flag.kind] ?? s.last_flag.kind}{s.last_flag.ms ? ` for ${Math.round(s.last_flag.ms / 1000)} s` : ''}, {ago(s.last_flag.at)}</div>}
                          </td>
                          <td className="r">
                            {s.hold_reason ? <Button size="xs" variant="primary" onClick={() => release({ student_id: s.id }, `${s.name} released.`)}>Release</Button> : <Button size="xs" onClick={() => setHold({ student: s })}>Hold</Button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
      {hold && <HoldModal target={hold} onClose={() => setHold(null)} onDone={data.refresh} />}
    </>
  );
}

function HoldModal({ target, onClose, onDone }: { target: { student?: Student; team?: Team }; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const who = target.student ? target.student.name : `Team ${target.team!.id}`;
  return (
    <Modal onClose={onClose} label="Hold">
      <div className="modal-body stack" style={{ gap: 14 }}>
        <h2>Hold {who}</h2>
        <p className="muted">Their screen locks with this message and the server refuses their answers until you release them. Their answers so far are kept.</p>
        <div className="field"><span className="label">Message: "Your proctor paused you: …"</span>
          <div className="stack" style={{ gap: 6 }}>
            {REASONS.map((r) => (
              <label key={r} className={`radio-row ${reason === r ? 'on' : ''}`}><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}</label>
            ))}
            <input className="input" value={REASONS.includes(reason) ? '' : reason} placeholder="Or write your own" onChange={(e) => setReason(e.target.value)} aria-label="Your own message" />
          </div>
        </div>
      </div>
      <div className="modal-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon="pause" busy={busy} onClick={async () => {
          setBusy(true);
          try {
            await call('st_hold', { student_id: target.student?.id, team_id: target.student ? undefined : target.team?.id, reason });
            toast(`${who} is on hold.`, 'good');
            onDone();
            onClose();
          } catch (e) {
            toast(e instanceof ApiError ? e.message : String(e), 'bad');
          } finally {
            setBusy(false);
          }
        }}>Hold {who}</Button>
      </div>
    </Modal>
  );
}
