import { useMemo, useState } from 'react';
import { ApiError, call } from '../../lib/api';
import { ago, downloadCsv } from '../../lib/format';
import { toast, usePoll } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, Confirm, ErrorNote, Modal, PageLoading, Seg } from '../../ui/kit';
import { parseSheet } from './Rounds';
import { useStaff } from './StaffApp';

type Student = { id: string; name: string; email: string; extra_minutes: number; disabled: boolean; devices: number; sessions: number; last_seen: string | null; flags: number };
type Team = { id: string; name: string; room_url: string; notes: string; students: Student[] };

export function Roster() {
  const { admin } = useStaff();
  const data = usePoll(() => call<{ teams: Team[] }>('st_roster'), 8000);
  const [q, setQ] = useState('');
  const [importing, setImporting] = useState(false);
  const [editTeam, setEditTeam] = useState<Partial<Team> | null>(null);
  const [editStudent, setEditStudent] = useState<(Partial<Student> & { team_id?: string; isNew?: boolean }) | null>(null);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: string; danger?: boolean; run: () => Promise<unknown> }>(null);
  const [view, setView] = useState<'all' | 'online' | 'missing' | 'flags'>('all');
  const teams = data.data?.teams ?? [];
  const all = teams.flatMap((t) => t.students);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return teams
      .map((t) => ({
        ...t,
        students: t.students.filter((s) => {
          if (view === 'online' && !s.devices) return false;
          if (view === 'missing' && s.sessions) return false;
          if (view === 'flags' && !s.flags) return false;
          return !needle || [s.id, s.name, s.email, t.id, t.name].some((x) => x.toLowerCase().includes(needle));
        }),
      }))
      .filter((t) => t.students.length || (!needle && view === 'all') || t.name.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle));
  }, [teams, q, view]);

  const act = async (p: object, msg: string) => {
    try {
      await call('st_roster_change', p);
      toast(msg, 'good');
      await data.refresh();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    }
  };

  if (!data.data) return data.error ? <ErrorNote error={data.error} onRetry={data.refresh} /> : <PageLoading />;
  return (
    <>
      <header>
        <div>
          <p className="label-sm">Set up</p>
          <h1>Teams &amp; students</h1>
          <p>{teams.length} teams · {all.length} students · {all.filter((s) => s.devices).length} online now · {all.filter((s) => !s.sessions).length} haven't signed in today. Students sign in with their ID and this email.</p>
        </div>
        <div className="row">
          <Button size="sm" icon="download" onClick={() => downloadCsv('sfmo-roster.csv', [['team_id', 'team_name', 'student_id', 'name', 'email', 'extra_minutes', 'room_url'], ...teams.flatMap((t) => t.students.map((s) => [t.id, t.name, s.id, s.name, s.email, s.extra_minutes, t.room_url]))])}>Export</Button>
          <Button size="sm" icon="logout" onClick={() => setConfirm({ title: 'Sign everyone out?', body: 'Every student has to sign in again with their ID and email. Answers are kept.', action: 'Sign everyone out', run: () => act({ action: 'sign_out_all' }, 'Everyone signed out.') })}>Sign everyone out</Button>
          {admin && <Button size="sm" icon="plus" onClick={() => setEditTeam({})}>Team</Button>}
          {admin && <Button size="sm" variant="primary" icon="upload" onClick={() => setImporting(true)}>Import CSV</Button>}
        </div>
      </header>

      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ maxWidth: 420, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: 11, color: 'var(--ink-3)' }}><Icon name="search" size={16} /></span>
          <input className="input" style={{ paddingLeft: 36 }} placeholder="Search names, IDs, emails, teams" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the roster" />
        </div>
        <Seg label="Show" value={view} onChange={setView} options={[['all', 'Everyone'], ['online', 'Online'], ['missing', 'Not signed in'], ['flags', 'Tab switches']]} />
      </div>

      {teams.length === 0 && (
        <div className="panel empty"><h3>No teams yet.</h3><p>Import the CSV from your registration form to add everyone at once.</p>{admin && <Button variant="primary" icon="upload" style={{ marginTop: 14 }} onClick={() => setImporting(true)}>Import CSV</Button>}</div>
      )}

      <div className="stack" style={{ gap: 12 }}>
        {filtered.map((t) => (
          <section key={t.id} className="panel">
            <div className="panel-head">
              <div className="row" style={{ gap: 10, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{t.id}</span>
                <h3>{t.name}</h3>
                <span className="faint" style={{ fontSize: 13 }}>{t.students.filter((s) => s.devices).length}/{t.students.length} online</span>
                {t.room_url && <a className="chip chip-outline" style={{ textTransform: 'none', letterSpacing: 0, textDecoration: 'none' }} href={t.room_url} target="_blank" rel="noreferrer"><Icon name="video" size={13} />Room</a>}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <Button size="xs" variant="ghost" icon="logout" onClick={() => act({ action: 'sign_out', team_id: t.id }, `Team ${t.id} signed out.`)}>Sign out team</Button>
                {admin && <Button size="xs" variant="ghost" icon="plus" onClick={() => setEditStudent({ team_id: t.id, isNew: true, extra_minutes: 0 })}>Student</Button>}
                {admin && <Button size="xs" variant="ghost" icon="edit" onClick={() => setEditTeam(t)} aria-label={`Edit team ${t.id}`} />}
              </div>
            </div>
            <div className="table-wrap">
              <table className="table" style={{ tableLayout: 'fixed', minWidth: 760 }}>
                <colgroup><col style={{ width: 70 }} /><col style={{ width: '22%' }} /><col style={{ width: '27%' }} /><col style={{ width: 150 }} /><col style={{ width: 70 }} /><col style={{ width: 120 }} /><col style={{ width: 190 }} /></colgroup>
                <tbody>
                  {t.students.map((s) => (
                    <tr key={s.id} style={{ opacity: s.disabled ? 0.55 : 1 }}>
                      <td style={{ width: 70 }} className="mono">{s.id}</td>
                      <td><b style={{ fontWeight: 500 }}>{s.name}</b>{s.disabled && <span className="chip chip-warn" style={{ marginLeft: 8 }}>Paused</span>}</td>
                      <td className="muted" style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.email}>{s.email}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {s.devices ? <span className="chip chip-good"><span className="dot" />Online{s.devices > 1 ? ` · ${s.devices} devices` : ''}</span> : s.last_seen ? <span className="faint" style={{ fontSize: 13 }}>Seen {ago(s.last_seen)}</span> : <span className="faint" style={{ fontSize: 13 }}>Not signed in</span>}
                      </td>
                      <td className="mono faint" style={{ fontSize: 13 }}>{s.extra_minutes ? `+${s.extra_minutes} min` : ''}</td>
                      <td>{s.flags ? <span className="chip chip-live">{s.flags} tab switch{s.flags === 1 ? '' : 'es'}</span> : null}</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <Button size="xs" variant="ghost" onClick={() => act({ action: 'sign_out', student_id: s.id }, `${s.name} signed out.`)} disabled={!s.sessions}>Sign out</Button>
                        <Button size="xs" variant="ghost" onClick={() => act({ action: s.disabled ? 'enable' : 'disable', student_id: s.id }, s.disabled ? `${s.name} can sign in again.` : `${s.name} is paused and signed out.`)}>{s.disabled ? 'Unpause' : 'Pause'}</Button>
                        {admin && <Button size="xs" variant="ghost" icon="edit" aria-label={`Edit ${s.name}`} onClick={() => setEditStudent({ ...s, team_id: t.id })} />}
                      </td>
                    </tr>
                  ))}
                  {t.students.length === 0 && <tr><td className="faint">No students on this team yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {importing && <ImportRoster onClose={() => setImporting(false)} onDone={data.refresh} />}
      {editTeam && <TeamModal team={editTeam} onClose={() => setEditTeam(null)} onDone={data.refresh} onDelete={(t) => setConfirm({ title: `Delete team ${t.id}?`, body: 'The team, its students and all their answers are deleted.', action: 'Delete team', danger: true, run: () => act({ action: 'delete_team', team_id: t.id }, `Team ${t.id} deleted.`) })} />}
      {editStudent && <StudentModal s={editStudent} teams={teams} onClose={() => setEditStudent(null)} onDone={data.refresh} onDelete={(s) => setConfirm({ title: `Delete ${s.name}?`, body: 'Their sign-in and individual answers are deleted.', action: 'Delete student', danger: true, run: () => act({ action: 'delete_student', student_id: s.id }, `${s.name} deleted.`) })} />}
      {confirm && <Confirm title={confirm.title} body={confirm.body} action={confirm.action} danger={confirm.danger} onClose={() => setConfirm(null)} onConfirm={confirm.run} />}
    </>
  );
}

function TeamModal({ team, onClose, onDone, onDelete }: { team: Partial<Team>; onClose: () => void; onDone: () => void; onDelete: (t: Team) => void }) {
  const isNew = !team.id;
  const [f, setF] = useState({ id: team.id ?? '', name: team.name ?? '', room_url: team.room_url ?? '', notes: team.notes ?? '' });
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Team">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await call('st_roster_change', { action: 'save_team', team_id: f.id, name: f.name, room_url: f.room_url, notes: f.notes });
          toast(isNew ? `Team ${f.id.toUpperCase()} added.` : 'Team saved.', 'good');
          onDone();
          onClose();
        } catch (x) {
          toast(x instanceof ApiError ? x.message : String(x), 'bad');
        } finally {
          setBusy(false);
        }
      }}>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <h2>{isNew ? 'New team' : `Team ${team.id}`}</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ width: 110 }}><label htmlFor="tm-id">Number</label><input id="tm-id" className="input mono" value={f.id} disabled={!isNew} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="07" required /></div>
            <div className="field grow"><label htmlFor="tm-n">Name</label><input id="tm-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          </div>
          <div className="field"><label htmlFor="tm-r">Zoom room link</label><input id="tm-r" className="input" value={f.room_url} onChange={(e) => setF({ ...f, room_url: e.target.value })} placeholder="Leave blank to use the event's default link" /></div>
          <div className="field"><label htmlFor="tm-notes">Notes (staff only)</label><input id="tm-notes" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
        </div>
        <div className="modal-foot">
          {!isNew && <Button variant="ghost" icon="trash" style={{ marginRight: 'auto', color: 'var(--bad)' }} onClick={() => { onClose(); onDelete(team as Team); }}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function StudentModal({ s, teams, onClose, onDone, onDelete }: { s: Partial<Student> & { team_id?: string; isNew?: boolean }; teams: Team[]; onClose: () => void; onDone: () => void; onDelete: (s: Student) => void }) {
  const [f, setF] = useState({ id: s.id ?? '', team_id: s.team_id ?? teams[0]?.id ?? '', name: s.name ?? '', email: s.email ?? '', extra_minutes: String(s.extra_minutes ?? 0) });
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="Student">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await call('st_roster_change', { action: 'save_student', student_id: f.id, team_id: f.team_id, name: f.name, email: f.email, extra_minutes: Number(f.extra_minutes) || 0 });
          toast('Student saved.', 'good');
          onDone();
          onClose();
        } catch (x) {
          toast(x instanceof ApiError ? x.message : String(x), 'bad');
        } finally {
          setBusy(false);
        }
      }}>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <h2>{s.isNew ? 'New student' : s.name}</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="field" style={{ width: 110 }}><label htmlFor="sm-id">Student ID</label><input id="sm-id" className="input mono" value={f.id} disabled={!s.isNew} onChange={(e) => setF({ ...f, id: e.target.value.toUpperCase() })} placeholder="07A" required /></div>
            <div className="field grow"><label htmlFor="sm-t">Team</label>
              <select id="sm-t" className="select" value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>{teams.map((t) => <option key={t.id} value={t.id}>{t.id} · {t.name}</option>)}</select>
            </div>
          </div>
          <div className="field"><label htmlFor="sm-n">Name</label><input id="sm-n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div className="field"><label htmlFor="sm-e">Email (how they sign in)</label><input id="sm-e" className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
          <div className="field" style={{ maxWidth: 220 }}><label htmlFor="sm-x">Extra minutes on individual rounds</label><input id="sm-x" className="input mono" type="number" min={0} max={600} value={f.extra_minutes} onChange={(e) => setF({ ...f, extra_minutes: e.target.value })} /><span className="hint">For accommodations. Team rounds end at the same time for everyone.</span></div>
        </div>
        <div className="modal-foot">
          {!s.isNew && <Button variant="ghost" icon="trash" style={{ marginRight: 'auto', color: 'var(--bad)' }} onClick={() => { onClose(); onDelete(s as Student); }}>Delete</Button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

const FIELDS = [
  ['team_id', 'Team number', /team\s*(number|no|#|id|num)|^team$/i],
  ['team_name', 'Team name', /team\s*name/i],
  ['student_id', 'Student ID', /student\s*id|^id$|competitor\s*id/i],
  ['name', 'Student name', /^(student\s*)?(full\s*)?name$|student$/i],
  ['email', 'Email', /e-?mail/i],
  ['room_url', 'Zoom link (optional)', /zoom|room|link/i],
] as const;

function ImportRoster({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const rows = useMemo(() => parseSheet(text), [text]);
  const header = rows[0] ?? [];
  const guess = useMemo(() => {
    const g: Record<string, number> = {};
    for (const [key, , re] of FIELDS) {
      const i = header.findIndex((h) => re.test(h.trim()) && !Object.values(g).includes(header.indexOf(h)));
      if (i >= 0) g[key] = i;
    }
    return g;
  }, [text]);
  const cols = { ...guess, ...map };
  const body = rows.slice(1);
  const out = body.map((r) => Object.fromEntries(FIELDS.map(([k]) => [k, cols[k] !== undefined ? (r[cols[k]] ?? '').trim() : ''])));
  const problems = out.map((r, i) => {
    if (!r.team_id) return `Row ${i + 2}: no team number`;
    if (r.student_id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return `Row ${i + 2}: "${r.email}" isn't an email`;
    if (r.student_id && !r.name) return `Row ${i + 2}: no name`;
    return null;
  }).filter(Boolean) as string[];
  const ready = out.length > 0 && cols.team_id !== undefined && problems.length === 0 && (mode === 'merge' || typed === 'REPLACE');

  return (
    <Modal onClose={() => !busy && onClose()} label="Import roster" wide>
      <div className="modal-body stack" style={{ gap: 14 }}>
        <h2>Import teams and students</h2>
        <p className="muted">One row per student, from your registration sheet. Paste the cells, or choose a CSV file. Rows for existing IDs are updated, so you can import again after late changes.</p>
        <div className="row">
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}><Icon name="upload" size={15} />Choose a CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          </label>
          <span className="faint" style={{ fontSize: 13 }}>or paste below</span>
        </div>
        <textarea className="textarea mono" style={{ minHeight: 110, fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Team number,Team name,Student ID,Name,Email\n07,Kelp Forest,07A,Ada Park,ada@example.com'} aria-label="Roster rows" />
        {header.length > 0 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
              {FIELDS.map(([k, label]) => (
                <div key={k} className="field"><label htmlFor={`map-${k}`}>{label}</label>
                  <select id={`map-${k}`} className="select" style={{ height: 36 }} value={cols[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? (undefined as unknown as number) : Number(e.target.value) })}>
                    <option value="">Not in the sheet</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="table-wrap panel" style={{ maxHeight: 220, overflow: 'auto' }}>
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr>{FIELDS.slice(0, 5).map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
                <tbody>{out.slice(0, 8).map((r, i) => <tr key={i}>{FIELDS.slice(0, 5).map(([k]) => <td key={k} className={k.endsWith('id') ? 'mono' : ''}>{r[k] || <span className="faint">—</span>}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p className="faint" style={{ fontSize: 13 }}>{out.length} rows · {new Set(out.map((r) => r.team_id.toUpperCase())).size} teams{out.length > 8 ? ' · showing the first 8' : ''}</p>
            {problems.length > 0 && <div className="banner banner-bad"><Icon name="alert" /><div>{problems.slice(0, 4).join(' · ')}{problems.length > 4 ? ` · and ${problems.length - 4} more` : ''}</div></div>}
            <div className="field"><span className="label">How</span>
              <Seg label="Import mode" value={mode} onChange={setMode} options={[['merge', 'Add and update'], ['replace', 'Replace everyone']]} />
              {mode === 'replace' && <div className="field" style={{ marginTop: 8, maxWidth: 360 }}><label htmlFor="imp-c">Anyone not in this sheet is deleted with their answers. Type <b className="mono">REPLACE</b>.</label><input id="imp-c" className="input mono" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())} /></div>}
            </div>
          </>
        )}
      </div>
      <div className="modal-foot">
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!ready} onClick={async () => {
          setBusy(true);
          try {
            const r = await call<{ teams_new: number; students_new: number; students_updated: number; removed: number }>('st_roster_import', { rows: out, replace: mode === 'replace' });
            toast(`Imported: ${r.teams_new} new teams, ${r.students_new} new students, ${r.students_updated} updated${r.removed ? `, ${r.removed} removed` : ''}.`, 'good');
            onDone();
            onClose();
          } catch (e) {
            toast(e instanceof ApiError ? e.message : String(e), 'bad');
          } finally {
            setBusy(false);
          }
        }}>Import {out.length || ''} rows</Button>
      </div>
    </Modal>
  );
}
