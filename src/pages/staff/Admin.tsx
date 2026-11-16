import { useMemo, useState } from 'react';
import { ApiError, call } from '../../lib/api';
import { ago, DEFAULT_TZ, timeOf } from '../../lib/format';
import { toast, usePoll } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, Confirm, CopyButton, ErrorNote, Modal, PageLoading, Seg, Switch } from '../../ui/kit';
import { useStaff } from './StaffApp';

// ---------------------------------------------------------------- tab switches

type Flag = { id: number; at: string; round_id: string; student_id: string; name: string; team_id: string; kind: string; ms: number };

export function Integrity() {
  const { s, tz } = useStaff();
  const [round, setRound] = useState('');
  const data = usePoll(() => call<{ events: Flag[] }>('st_integrity', { round }), 5000, [round]);
  const [by, setBy] = useState<'time' | 'student'>('student');
  const events = data.data?.events ?? [];
  const grouped = useMemo(() => {
    const m = new Map<string, { id: string; name: string; team: string; n: number; total: number; last: string }>();
    for (const e of events) {
      const g = m.get(e.student_id) ?? { id: e.student_id, name: e.name, team: e.team_id, n: 0, total: 0, last: e.at };
      g.n++;
      g.total += e.ms;
      if (e.at > g.last) g.last = e.at;
      m.set(e.student_id, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [events]);
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Live</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Tab switches</h1>
          <p>Every time a student's test tab went into the background or lost focus during an open round, and for how long. A browser can't see phones or a second computer: that's what cameras in Zoom are for.</p>
        </div>
        <div className="row">
          <select className="select" style={{ width: 'auto' }} value={round} onChange={(e) => setRound(e.target.value)} aria-label="Round">
            <option value="">All rounds</option>
            {s.rounds.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <Seg label="Group" value={by} onChange={setBy} options={[['student', 'By student'], ['time', 'Timeline']]} />
        </div>
      </header>
      {!data.data ? (data.error ? <ErrorNote error={data.error} /> : <PageLoading />) : events.length === 0 ? (
        <div className="panel empty"><h3>No tab switches.</h3><p>They show up here within a few seconds of happening.</p></div>
      ) : (
        <div className="panel"><div className="table-wrap">
          {by === 'student' ? (
            <table className="table">
              <thead><tr><th>Student</th><th>Team</th><th className="r">Times</th><th className="r">Total away</th><th>Last</th></tr></thead>
              <tbody>{grouped.map((g) => (
                <tr key={g.id}><td><span className="mono faint">{g.id}</span> {g.name}</td><td className="mono">{g.team}</td><td className="r mono">{g.n}</td>
                  <td className="r mono" style={{ color: g.total > 60_000 ? 'var(--bad)' : undefined }}>{Math.round(g.total / 1000)} s</td><td className="faint">{ago(g.last)}</td></tr>
              ))}</tbody>
            </table>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>Student</th><th>Round</th><th>What</th><th className="r">Away</th></tr></thead>
              <tbody>{events.map((e) => (
                <tr key={e.id}><td className="mono">{timeOf(e.at, tz || DEFAULT_TZ, true)}</td><td><span className="mono faint">{e.student_id}</span> {e.name}</td><td className="muted">{e.round_id}</td>
                  <td>{e.kind === 'hidden' ? 'Left the tab' : e.kind === 'blur' ? 'Window lost focus' : e.kind}</td><td className="r mono">{Math.round(e.ms / 1000)} s</td></tr>
              ))}</tbody>
            </table>
          )}
        </div></div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- staff & invites

type StaffRow = { user_id: string; email: string; name: string; role: 'admin' | 'proctor'; created_at: string };
type Invite = { code: string; role: string; name: string; created_at: string; expires_at: string };

export function StaffTeam() {
  const { s } = useStaff();
  const data = usePoll(() => call<{ staff: StaffRow[]; invites: Invite[] }>('st_staff'), 15000);
  const [invite, setInvite] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [remove, setRemove] = useState<StaffRow | null>(null);
  const change = async (p: object, msg: string) => {
    try {
      await call('st_staff_change', p);
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
          <span className="eyebrow">Admin</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Staff &amp; invites</h1>
          <p>Proctors run rounds, send announcements, fire Mystery events and sign students out. Admins can also edit problems, the roster and settings, and reset things.</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setInvite(true)}>Invite someone</Button>
      </header>
      {!data.data ? <PageLoading /> : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="panel"><div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th><th /></tr></thead>
              <tbody>{data.data.staff.map((m) => (
                <tr key={m.user_id}>
                  <td><b style={{ fontWeight: 500 }}>{m.name || '—'}</b>{m.user_id === s.me.user_id && <span className="faint"> (you)</span>}</td>
                  <td className="muted">{m.email}</td>
                  <td>
                    <select className="select" style={{ height: 32, width: 'auto' }} value={m.role} onChange={(e) => change({ action: 'set_role', user_id: m.user_id, role: e.target.value }, 'Role changed.')} aria-label={`Role for ${m.email}`}>
                      <option value="proctor">Proctor</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="faint">{ago(m.created_at)}</td>
                  <td className="r"><Button size="xs" variant="ghost" icon="trash" onClick={() => setRemove(m)}>Remove</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div></div>
          {data.data.invites.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h3>Open invites</h3></div>
              <div className="table-wrap"><table className="table">
                <tbody>{data.data.invites.map((i) => (
                  <tr key={i.code}><td className="mono" style={{ fontSize: 15 }}>{i.code}</td><td>{i.name || <span className="faint">Anyone</span>}</td><td className="muted">{i.role}</td><td className="faint">expires {ago(i.expires_at).replace(' ago', '') === 'just now' ? 'soon' : new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="r"><CopyButton text={i.code} /> <Button size="xs" variant="ghost" onClick={() => change({ action: 'revoke_invite', code: i.code }, 'Invite cancelled.')}>Cancel</Button></td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
          <div className="sunk" style={{ padding: '16px 18px', fontSize: 14 }}>
            <b>How joining works.</b> <span className="muted">Send the person the code. They open this site, choose Staff, create an account with their email and a password, and enter the code. Each code works once.</span>
          </div>
        </div>
      )}
      {invite && <InviteModal onClose={() => setInvite(false)} onCode={(c) => { setCode(c); data.refresh(); }} />}
      {code && (
        <Modal onClose={() => setCode(null)} label="Invite code">
          <div className="modal-body stack" style={{ gap: 14 }}>
            <h2>Invite code</h2>
            <div className="code-box pop">{code}</div>
            <p className="muted">Send this to them with the site address. It works once and expires in two weeks.</p>
          </div>
          <div className="modal-foot"><CopyButton text={code} label="Copy code" /><Button variant="primary" onClick={() => setCode(null)}>Done</Button></div>
        </Modal>
      )}
      {remove && <Confirm title={`Remove ${remove.name || remove.email}?`} danger action="Remove" body="They lose staff access straight away. Their account still exists, so you can invite them again later." onClose={() => setRemove(null)} onConfirm={() => change({ action: 'remove', user_id: remove.user_id }, 'Removed from staff.')} />}
    </>
  );
}

function InviteModal({ onClose, onCode }: { onClose: () => void; onCode: (c: string) => void }) {
  const [role, setRole] = useState<'proctor' | 'admin'>('proctor');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Invite">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await call<{ code: string }>('st_staff_change', { action: 'invite', role, name });
          onClose();
          onCode(r.code);
        } catch (x) {
          toast(x instanceof ApiError ? x.message : String(x), 'bad');
        } finally {
          setBusy(false);
        }
      }}>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <h2>Invite someone</h2>
          <div className="field"><label htmlFor="iv-n">Their name (optional)</label><input id="iv-n" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Nand" /></div>
          <div className="field"><span className="label">Role</span><Seg label="Role" value={role} onChange={setRole} options={[['proctor', 'Proctor'], ['admin', 'Admin']]} /></div>
        </div>
        <div className="modal-foot"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Make a code</Button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- event settings

export function EventSettings() {
  const { s, refresh } = useStaff();
  const [f, setF] = useState(() => ({ ...s.settings }));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: string, label: string, hint?: string, area = false) => (
    <div className="field"><label htmlFor={`set-${k}`}>{label}</label>
      {area ? <textarea id={`set-${k}`} className="textarea" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /> : <input id={`set-${k}`} className="input" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
  const save = async () => {
    setBusy(true);
    try {
      const { session_hours, ...rest } = f;
      await call('st_settings_save', { data: { ...rest, session_hours: Number(session_hours) || 16 } });
      toast('Settings saved.', 'good');
      await refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Admin</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Event settings</h1>
          <p>What students see before and between rounds, how sign-in works, and how strict the test screen is.</p>
        </div>
      </header>
      <div className="stack" style={{ gap: 18, maxWidth: 860 }}>
        <section className="panel panel-pad stack" style={{ gap: 14 }}>
          <h3>The event</h3>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow">{text('event_name', 'Name')}</div>
            <div className="grow">{text('event_subtitle', 'Subtitle')}</div>
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ width: 200 }}><label htmlFor="set-date">Date</label><input id="set-date" className="input mono" type="date" value={f.event_date ?? ''} onChange={(e) => set('event_date', e.target.value)} /></div>
            <div className="field grow"><label htmlFor="set-tz">Time zone for every time shown</label>
              <select id="set-tz" className="select" value={f.timezone} onChange={(e) => set('timezone', e.target.value)}>
                {['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Pacific/Honolulu', 'America/Anchorage', 'UTC'].map((z) => <option key={z} value={z}>{z.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>
          {text('welcome', 'Welcome message on the home page', undefined, true)}
          {text('help_text', 'Help text', 'Shown on the home page under "Need help?"')}
          {text('contact_email', 'Contact email')}
          {text('zoom_url', 'Default Zoom link', 'Teams without their own room link get this one.')}
        </section>
        <section className="panel panel-pad stack" style={{ gap: 14 }}>
          <h3>Sign-in</h3>
          <Switch id="set-open" checked={f.signin_open !== false} onChange={(v) => set('signin_open', v)} label="Students can sign in" />
          {text('signin_closed_message', 'Message while sign-in is closed')}
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="set-hours">Stay signed in for (hours)</label><input id="set-hours" className="input mono" type="number" min={1} max={72} value={f.session_hours ?? 16} onChange={(e) => set('session_hours', e.target.value)} /></div>
        </section>
        <section className="panel panel-pad stack" style={{ gap: 14 }}>
          <h3>Test screen</h3>
          <div className="field"><span className="label">When a student leaves the test tab</span>
            <Seg label="Tab policy" value={f.integrity ?? 'warn'} onChange={(v) => set('integrity', v)} options={[['warn', 'Log it and tell them'], ['log', 'Log it quietly'], ['off', 'Ignore it']]} />
          </div>
          <Switch id="set-boards" checked={!!f.public_boards} onChange={(v) => set('public_boards', v)} label="Anyone with the link can open the projector boards (for screen sharing or a stream)" />
        </section>
        <div className="save-dock"><span className="grow" /><Button variant="primary" busy={busy} onClick={save}>Save settings</Button></div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- activity

export function Activity() {
  const { tz } = useStaff();
  const data = usePoll(() => call<{ entries: { id: number; at: string; actor: string; action: string; detail: any }[] }>('st_audit'), 10000);
  const label = (a: string) => a.replace(/_/g, ' ').replace(/^round /, 'round: ').replace(/^roster /, 'roster: ').replace(/^staff /, 'staff: ').replace(/^reset /, 'reset: ');
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Admin</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Activity log</h1>
          <p>Every change staff made, newest first: who, what and when. Useful after the contest for appeals.</p>
        </div>
      </header>
      {!data.data ? <PageLoading /> : (
        <div className="panel"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>{data.data.entries.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{timeOf(e.at, tz || DEFAULT_TZ, true)}</td>
                <td>{e.actor}</td>
                <td><b style={{ fontWeight: 500 }}>{label(e.action)}</b></td>
                <td className="mono faint" style={{ fontSize: 12, maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.detail ? JSON.stringify(e.detail) : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div></div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- resets

const RESETS = [
  { scope: 'sessions', title: 'Sign everyone out', body: 'Every student signs in again. Nothing else changes.' },
  { scope: 'announcements', title: 'Clear announcements', body: 'Removes every announcement from students\' screens.' },
  { scope: 'answers', title: 'Clear all answers', body: 'Every round back to not started: answers, Guts sets, Mystery depths, events and tab-switch logs. Problems and roster stay. Do this after a rehearsal.' },
  { scope: 'problems', title: 'Delete all problems', body: 'Every problem in every round, and the answers to them. Rounds and roster stay.' },
  { scope: 'roster', title: 'Delete every team and student', body: 'The whole roster, their sign-ins and their answers. Problems and rounds stay.' },
  { scope: 'everything', title: 'Factory reset', body: 'Back to a fresh install: default rounds and settings, no roster, no problems, no answers. Staff accounts stay.' },
];

export function DangerZone() {
  const { refresh } = useStaff();
  const [ask, setAsk] = useState<(typeof RESETS)[number] | null>(null);
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Admin</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Reset &amp; clean up</h1>
          <p>For rehearsals and the end of the day. Each one asks you to type RESET first, and each is recorded in the activity log. To reset a single round, use Reset on its controls.</p>
        </div>
      </header>
      <div className="danger-zone" style={{ maxWidth: 860 }}>
        {RESETS.map((r) => (
          <div key={r.scope} className="danger-row">
            <div><b>{r.title}</b><p className="muted" style={{ fontSize: 14, marginTop: 2 }}>{r.body}</p></div>
            <Button variant={r.scope === 'sessions' || r.scope === 'announcements' ? 'default' : 'danger'} size="sm" onClick={() => setAsk(r)}>{r.title}</Button>
          </div>
        ))}
      </div>
      {ask && (
        <Confirm title={`${ask.title}?`} body={ask.body} danger action={ask.title} word="RESET" onClose={() => setAsk(null)}
          onConfirm={async () => {
            try {
              await call('st_reset', { scope: ask.scope, confirm: 'RESET' });
              toast(`${ask.title}: done.`, 'good');
              await refresh();
            } catch (e) {
              toast(e instanceof ApiError ? e.message : String(e), 'bad');
            }
          }} />
      )}
      <p className="faint" style={{ fontSize: 13, marginTop: 18, display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="info" size={15} />Supabase Pro keeps daily backups for seven days if you need to undo one of these.</p>
    </>
  );
}
