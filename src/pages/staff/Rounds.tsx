import { useEffect, useMemo, useState } from 'react';
import { ApiError, call } from '../../lib/api';
import { keysFor, splitKeys } from '../../lib/answers';
import { fromLocalInput, timeOf, toLocalInput } from '../../lib/format';
import { go, toast } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, Confirm, Modal, PageLoading, Rich, Seg, Switch } from '../../ui/kit';
import { RoundControls, StateChip } from './Control';
import { useStaff, type StaffRound } from './StaffApp';

const KIND: Record<string, string> = { individual: 'Individual (each student alone)', guts: 'Guts (team, sets of problems)', mystery: 'Mystery Dive (team, live submarine)' };

export function RoundsList() {
  const { s, admin, refresh, tz } = useStaff();
  const [create, setCreate] = useState(false);
  const move = async (r: StaffRound, dir: -1 | 1) => {
    const list = [...s.rounds];
    const i = list.findIndex((x) => x.id === r.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    for (let k = 0; k < list.length; k++) if (list[k].sort !== k) await call('st_round_save', { id: list[k].id, sort: k });
    refresh();
  };
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">Set up</span>
          <h1 style={{ fontSize: 34, marginTop: 6 }}>Rounds &amp; problems</h1>
          <p>The rounds students see on their home page, in this order. Open one to change its settings and problems.</p>
        </div>
        {admin && <Button variant="primary" icon="plus" onClick={() => setCreate(true)}>New round</Button>}
      </header>
      <div className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ width: 70 }}>Order</th><th>Round</th><th>Type</th><th>Status</th><th className="r">Problems</th><th>Planned</th><th /></tr></thead>
            <tbody>
              {s.rounds.map((r, i) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => go(`staff-round-${r.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {admin && <div className="row" style={{ gap: 2 }}>
                      <Button size="xs" variant="ghost" icon="down" style={{ transform: 'rotate(180deg)' }} disabled={i === 0} onClick={() => move(r, -1)} aria-label="Move up" />
                      <Button size="xs" variant="ghost" icon="down" disabled={i === s.rounds.length - 1} onClick={() => move(r, 1)} aria-label="Move down" />
                    </div>}
                  </td>
                  <td><b>{r.title}</b>{!r.visible && <span className="chip chip-outline" style={{ marginLeft: 8 }}>Hidden</span>}<div className="faint" style={{ fontSize: 13 }}>{r.blurb}</div></td>
                  <td className="muted">{r.kind === 'mystery' ? 'Mystery Dive' : r.kind === 'guts' ? 'Guts' : 'Individual'}</td>
                  <td><StateChip r={r} /></td>
                  <td className="r mono">{r.problem_count}{r.keys_missing ? <span style={{ color: 'var(--bad)' }} title="Problems without an answer key"> · {r.keys_missing}!</span> : ''}</td>
                  <td className="mono muted">{r.scheduled_at ? timeOf(r.scheduled_at, tz) : '—'}</td>
                  <td className="r"><Icon name="right" size={16} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {create && <NewRound onClose={() => setCreate(false)} />}
    </>
  );
}

function NewRound({ onClose }: { onClose: () => void }) {
  const { refresh } = useStaff();
  const [kind, setKind] = useState<'individual' | 'guts' | 'mystery'>('individual');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal onClose={onClose} label="New round">
      <form onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await call<StaffRound>('st_round_save', { kind, title: title || 'New round' });
          await refresh();
          go(`staff-round-${r.id}`);
        } catch (x) {
          toast(x instanceof ApiError ? x.message : String(x), 'bad');
        } finally {
          setBusy(false);
        }
      }}>
        <div className="modal-body stack" style={{ gap: 14 }}>
          <h2>New round</h2>
          <div className="field"><label htmlFor="nr-t">Name</label><input id="nr-t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tiebreaker" /></div>
          <div className="field"><span className="label">Type</span>
            <div className="stack" style={{ gap: 6 }}>
              {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
                <label key={k} className="check" style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, background: kind === k ? 'var(--bg-sunk)' : undefined }}>
                  <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k as typeof kind)} />{KIND[k]}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-foot"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Create</Button></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- editor

type Row = { id?: string; set_no: number; points: number; body: string; answer: string };

export function RoundEditor({ id }: { id: string }) {
  const { s, admin, refresh, tz } = useStaff();
  const r = s.rounds.find((x) => x.id === id);
  const [tab, setTab] = useState<'problems' | 'settings'>('problems');
  if (!r) return <div className="empty"><h3>That round doesn't exist.</h3><button className="linkish" onClick={() => go('staff-rounds')}>All rounds</button></div>;
  return (
    <>
      <header>
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: -12 }} onClick={() => go('staff-rounds')}><Icon name="back" size={15} />All rounds</button>
          <div className="row" style={{ marginTop: 6 }}><h1 style={{ fontSize: 34 }}>{r.title}</h1><StateChip r={r} /></div>
          <p>{KIND[r.kind]} · {r.minutes} minutes{r.scheduled_at ? ` · planned for ${timeOf(r.scheduled_at, tz)}` : ''}</p>
        </div>
        <RoundControls r={r} />
      </header>
      <div style={{ marginBottom: 20 }}><Seg label="Section" value={tab} onChange={setTab} options={[['problems', `Problems · ${r.problem_count}`], ['settings', 'Settings']]} /></div>
      {tab === 'problems' ? <ProblemsEditor r={r} admin={admin} onSaved={refresh} /> : <RoundSettings r={r} admin={admin} onSaved={refresh} />}
    </>
  );
}

function ProblemsEditor({ r, admin, onSaved }: { r: StaffRound; admin: boolean; onSaved: () => Promise<void> }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orig, setOrig] = useState('');
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const load = async () => {
    const d = await call<{ problems: (Row & { id: string; keys: string[] })[] }>('st_problems', { round: r.id });
    const list = d.problems.map((p) => ({ id: p.id, set_no: p.set_no, points: p.points, body: p.body, answer: p.answer }));
    setRows(list);
    setOrig(JSON.stringify(list));
  };
  useEffect(() => {
    load().catch((e) => toast(e.message, 'bad'));
  }, [r.id]);
  if (!rows) return <PageLoading />;
  const dirty = JSON.stringify(rows) !== orig;
  const removed = (JSON.parse(orig || '[]') as Row[]).filter((o) => o.id && !rows.some((x) => x.id === o.id)).length;
  const live = r.state === 'open' || r.state === 'paused';
  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setBusy(true);
    try {
      await call('st_problems_save', { round: r.id, problems: rows.map((p) => ({ ...p, keys: keysFor(splitKeys(p.answer)) })) });
      toast('Problems saved.', 'good');
      await load();
      await onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {live && <div className="banner banner-urgent" style={{ marginBottom: 14 }}><Icon name="alert" /><div>This round is running. Saving changes what students see straight away; fixing a typo is fine, renumbering mid-round is not.</div></div>}
      <div className="spread" style={{ marginBottom: 14 }}>
        <p className="muted" style={{ maxWidth: 640, fontSize: 14 }}>Write maths between dollar signs, like <span className="mono">$x^2 + 1$</span>. In the answer box, list every form you accept separated by <span className="mono">|</span>. Plain numbers already match any equal value (0.375 = 3/8).</p>
        <div className="row">
          <Button size="sm" icon="eye" onClick={() => setPreview(true)}>Preview as a student</Button>
          {admin && <Button size="sm" icon="upload" onClick={() => setPaste(true)}>Paste from a spreadsheet</Button>}
        </div>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {rows.length === 0 && <div className="empty panel"><h3>No problems yet.</h3><p>Add them one by one or paste a whole sheet.</p></div>}
        {rows.map((p, i) => (
          <div key={p.id ?? `new-${i}`} className="panel" style={{ padding: 16, display: 'grid', gridTemplateColumns: '48px minmax(0,1fr) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600 }}>{i + 1}</div>
              {admin && <div className="stack" style={{ gap: 2, marginTop: 6 }}>
                <Button size="xs" variant="ghost" icon="down" style={{ transform: 'rotate(180deg)' }} disabled={i === 0} onClick={() => setRows((rs) => { const a = [...rs!]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })} aria-label="Move up" />
                <Button size="xs" variant="ghost" icon="down" disabled={i === rows.length - 1} onClick={() => setRows((rs) => { const a = [...rs!]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })} aria-label="Move down" />
              </div>}
            </div>
            <div className="stack" style={{ gap: 8, minWidth: 0 }}>
              <textarea className="textarea" style={{ minHeight: 90, fontSize: 14 }} value={p.body} disabled={!admin} onChange={(e) => update(i, { body: e.target.value })} aria-label={`Problem ${i + 1} text`} />
              <div className="row" style={{ gap: 8 }}>
                <div className="field grow"><label htmlFor={`ans-${i}`}>Accepted answers</label><input id={`ans-${i}`} className="input mono" value={p.answer} disabled={!admin} onChange={(e) => update(i, { answer: e.target.value })} placeholder="3/8 | 0.375" /></div>
                {r.kind === 'guts' && <div className="field" style={{ width: 70 }}><label htmlFor={`set-${i}`}>Set</label><input id={`set-${i}`} className="input mono" type="number" min={1} value={p.set_no} disabled={!admin} onChange={(e) => update(i, { set_no: Number(e.target.value) })} /></div>}
                <div className="field" style={{ width: 80 }}><label htmlFor={`pts-${i}`}>Points</label><input id={`pts-${i}`} className="input mono" type="number" step="0.5" value={p.points} disabled={!admin} onChange={(e) => update(i, { points: Number(e.target.value) })} /></div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {keysFor(splitKeys(p.answer)).map((k) => <span key={k} className="chip chip-outline mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{k}</span>)}
                {!p.answer.trim() && <span className="chip chip-bad">No answer key</span>}
                {admin && <Button size="xs" variant="ghost" icon="trash" style={{ marginLeft: 'auto' }} onClick={() => setRows((rs) => rs!.filter((_, j) => j !== i))}>Remove</Button>}
              </div>
            </div>
            <div className="preview-frame" style={{ minWidth: 0 }}><span className="eyebrow">Preview</span><Rich text={p.body || '*Empty*'} className="" /></div>
          </div>
        ))}
      </div>
      {admin && (
        <div className="save-dock">
          <Button icon="plus" onClick={() => setRows((rs) => [...rs!, { set_no: rs!.length ? rs![rs!.length - 1].set_no : 1, points: rs!.length ? rs![rs!.length - 1].points : 1, body: '', answer: '' }])}>Add problem</Button>
          <span className="grow faint" style={{ fontSize: 13.5 }}>{dirty ? `Unsaved changes${removed ? ` · ${removed} removed (their answers go too)` : ''}` : 'All saved'}</span>
          <Button onClick={load} disabled={!dirty || busy}>Discard</Button>
          <Button variant="primary" busy={busy} disabled={!dirty} onClick={() => (removed ? setConfirm(true) : save())}>Save problems</Button>
        </div>
      )}
      {confirm && <Confirm title={`Remove ${removed} problem${removed === 1 ? '' : 's'}?`} danger action="Save and remove" onClose={() => setConfirm(false)} body="Any answers students gave to the removed problems are deleted with them." onConfirm={save} />}
      {paste && <PasteProblems kind={r.kind} onClose={() => setPaste(false)} onUse={(list, replace) => setRows((rs) => (replace ? list : [...rs!, ...list]))} />}
      {preview && (
        <Modal onClose={() => setPreview(false)} label="Preview" wide>
          <div className="modal-body">
            <span className="eyebrow">What students see · {r.title}</span>
            {rows.map((p, i) => (
              <section key={i} className="problem" style={{ animation: 'none' }}>
                <div className="problem-n"><b>{i + 1}</b>{r.kind === 'guts' ? `Set ${p.set_no}` : ''}</div>
                <div style={{ minWidth: 0 }}><Rich text={p.body} /><input className="input input-lg answer mono" style={{ marginTop: 14 }} placeholder="Your answer" aria-label="Answer preview" /></div>
              </section>
            ))}
          </div>
          <div className="modal-foot"><Button variant="primary" onClick={() => setPreview(false)}>Close preview</Button></div>
        </Modal>
      )}
    </>
  );
}

/** Rows from Google Sheets or Excel: problem, answer, then optional points and set. */
export function parseSheet(text: string): string[][] {
  const tab = text.includes('\t');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === (tab ? '\t' : ',')) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function PasteProblems({ kind, onClose, onUse }: { kind: string; onClose: () => void; onUse: (rows: Row[], replace: boolean) => void }) {
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(true);
  const parsed = useMemo(() => {
    const rows = parseSheet(text);
    const header = rows[0] && /problem|question|text/i.test(rows[0][0] ?? '') ? 1 : 0;
    return rows.slice(header).map((c) => ({ body: (c[0] ?? '').trim(), answer: (c[1] ?? '').trim(), points: Number(c[2]) || 1, set_no: Number(c[3]) || 1 }));
  }, [text]);
  return (
    <Modal onClose={onClose} label="Paste problems" wide>
      <div className="modal-body stack" style={{ gap: 14 }}>
        <h2>Paste from a spreadsheet</h2>
        <p className="muted">Copy the cells straight from Google Sheets or Excel. Columns: <b>problem</b>, <b>answer</b>{kind === 'guts' ? <>, <b>points</b>, <b>set</b></> : <>, then <b>points</b> if not 1</>}. A header row is skipped.</p>
        <textarea className="textarea mono" style={{ minHeight: 160, fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'How many divisors does $36$ have?\t9\nCompute $2^{10}$.\t1024'} aria-label="Pasted cells" />
        {parsed.length > 0 && <p className="faint" style={{ fontSize: 13.5 }}>{parsed.length} problems found. First: “{parsed[0].body.slice(0, 80)}” → <span className="mono">{parsed[0].answer || 'no answer'}</span></p>}
        <Switch id="paste-replace" checked={replace} onChange={setReplace} label="Replace the problems in the editor (otherwise add to the end)" />
      </div>
      <div className="modal-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!parsed.length} onClick={() => { onUse(parsed, replace); onClose(); toast('Pasted. Review, then save.'); }}>Use {parsed.length || ''} problems</Button>
      </div>
    </Modal>
  );
}

function RoundSettings({ r, admin, onSaved }: { r: StaffRound; admin: boolean; onSaved: () => Promise<void> }) {
  const { tz } = useStaff();
  const [f, setF] = useState(() => ({
    title: r.title, blurb: r.blurb, rules: r.rules, minutes: String(r.minutes), grace_seconds: String(r.grace_seconds),
    scheduled_at: toLocalInput(r.scheduled_at, tz), visible: r.visible, show_results: r.show_results, config: { ...r.config } as Record<string, any>,
  }));
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const cfg = (k: string, v: unknown) => setF((x) => ({ ...x, config: { ...x.config, [k]: v } }));
  const num = (k: string, label: string, step = '1', hint?: string) => (
    <div className="field"><label htmlFor={`cfg-${k}`}>{label}</label><input id={`cfg-${k}`} className="input mono" type="number" step={step} value={f.config[k] ?? ''} disabled={!admin} onChange={(e) => cfg(k, e.target.value === '' ? null : Number(e.target.value))} />{hint && <span className="hint">{hint}</span>}</div>
  );
  const save = async () => {
    setBusy(true);
    try {
      await call('st_round_save', { id: r.id, title: f.title, blurb: f.blurb, rules: f.rules, minutes: Number(f.minutes), grace_seconds: Number(f.grace_seconds), scheduled_at: fromLocalInput(f.scheduled_at, tz) ?? '', visible: f.visible, show_results: f.show_results, config: f.config });
      toast('Settings saved.', 'good');
      await onSaved();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const sinkLife = Number(f.config.start ?? 200) / Math.max(0.0001, Number(f.config.sink_rate ?? 0.1));
  return (
    <div className="stack" style={{ gap: 18, maxWidth: 860 }}>
      <section className="panel panel-pad stack" style={{ gap: 14 }}>
        <h3>Basics</h3>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="field grow"><label htmlFor="rs-t">Name</label><input id="rs-t" className="input" value={f.title} disabled={!admin} onChange={(e) => set({ title: e.target.value })} /></div>
          <div className="field" style={{ width: 120 }}><label htmlFor="rs-m">Minutes</label><input id="rs-m" className="input mono" type="number" min={1} value={f.minutes} disabled={!admin} onChange={(e) => set({ minutes: e.target.value })} /></div>
          <div className="field" style={{ width: 150 }}><label htmlFor="rs-g">Grace (seconds)</label><input id="rs-g" className="input mono" type="number" min={0} max={300} value={f.grace_seconds} disabled={!admin} onChange={(e) => set({ grace_seconds: e.target.value })} /></div>
        </div>
        {r.state !== 'waiting' && <p className="hint">Changing minutes affects the next start. To change a running round's end time, use +5 min or Close in the controls.</p>}
        <div className="field"><label htmlFor="rs-b">One-line description</label><input id="rs-b" className="input" value={f.blurb} disabled={!admin} onChange={(e) => set({ blurb: e.target.value })} /></div>
        <div className="field"><label htmlFor="rs-r">Rules (shown before and during the round)</label><textarea id="rs-r" className="textarea" value={f.rules} disabled={!admin} onChange={(e) => set({ rules: e.target.value })} /></div>
        <div className="field" style={{ maxWidth: 280 }}><label htmlFor="rs-s">Planned start (shown on the schedule)</label><input id="rs-s" className="input mono" type="datetime-local" value={f.scheduled_at} disabled={!admin} onChange={(e) => set({ scheduled_at: e.target.value })} /><span className="hint">Display only. Use Schedule in the controls to open it automatically.</span></div>
        <div className="stack" style={{ gap: 10 }}>
          <Switch id="rs-vis" checked={f.visible} onChange={(v) => admin && set({ visible: v })} label="Students can see this round" />
          {r.kind !== 'mystery' && <Switch id="rs-res" checked={f.show_results} onChange={(v) => admin && set({ show_results: v })} label="After it closes, students see their score and the answers" />}
        </div>
      </section>

      {r.kind === 'mystery' && (
        <section className="panel panel-pad stack" style={{ gap: 14 }}>
          <h3>Submarine rules</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {num('start', 'Starting score')}
            {num('sink_rate', 'Sinking per second', '0.01')}
            {num('patch', 'Patch is worth')}
            {num('torpedo', 'Torpedo takes')}
            {num('salvage', 'Salvage brings back to')}
          </div>
          <p className="hint">With these numbers, a team that never answers reaches Rock Bottom after {Math.floor(sinkLife / 60)} min {Math.round(sinkLife % 60)} s; the round lasts {f.minutes} min. Changing the sinking speed during the dive applies from the moment you save; nobody's depth jumps.</p>
          <div className="stack" style={{ gap: 10 }}>
            <Switch id="cfg-board" checked={f.config.show_board !== false} onChange={(v) => admin && cfg('show_board', v)} label="Teams see every team's depth (sonar and standings)" />
            <Switch id="cfg-anon" checked={!!f.config.anonymous_attacks} onChange={(v) => admin && cfg('anonymous_attacks', v)} label="Hide who fired each torpedo" />
            <Switch id="cfg-sunk" checked={!!f.config.allow_hit_sunk} onChange={(v) => admin && cfg('allow_hit_sunk', v)} label="Allow torpedoes at teams already on Rock Bottom" />
          </div>
        </section>
      )}
      {r.kind === 'guts' && (
        <section className="panel panel-pad stack" style={{ gap: 10 }}>
          <h3>Guts</h3>
          <Switch id="cfg-gboard" checked={f.config.show_board !== false} onChange={(v) => admin && cfg('show_board', v)} label="Show the live board next to the problems" />
          <Switch id="cfg-reveal" checked={f.config.reveal_set_scores !== false} onChange={(v) => admin && cfg('reveal_set_scores', v)} label="Tell a team how many it got right when it hands in a set" />
        </section>
      )}
      {admin && (
        <div className="save-dock">
          <Button variant="danger" icon="trash" onClick={() => setDel(true)}>Delete round</Button>
          <span className="grow" />
          <Button variant="primary" busy={busy} onClick={save}>Save settings</Button>
        </div>
      )}
      {del && <Confirm title={`Delete ${r.title}?`} danger word="DELETE" action="Delete for good" onClose={() => setDel(false)}
        body="The round, its problems and every answer in it are deleted. This can't be undone."
        onConfirm={async () => { await call('st_round_delete', { id: r.id }); await onSaved(); go('staff-rounds'); toast('Round deleted.'); }} />}
    </div>
  );
}
