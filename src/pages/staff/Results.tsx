import { Fragment, useState } from 'react';
import { ApiError, call } from '../../lib/api';
import { downloadCsv, points, score1 } from '../../lib/format';
import { go, toast, usePoll } from '../../lib/hooks';
import { Icon } from '../../ui/icons';
import { Button, ErrorNote, PageLoading, Seg } from '../../ui/kit';
import { StateChip } from './Control';
import { useStaff, type StaffRound } from './StaffApp';

type Problem = { id: string; number: number; set_no: number; points: number; answer: string; keys: string[] };
type Row = {
  id: string; name: string; team_id?: string; team_name?: string; score: number; correct?: number; answered?: number; sets?: number; flags?: number;
  sunk?: boolean; wrong?: number; patches?: number; torpedoes?: number; hits_taken?: number;
  answers: Record<string, { raw: string; ok: boolean; counts?: boolean }>;
};
type Review = { problem_id: string; number: number; norm: string; raw: string; count: number; ruling: boolean | null };
type Data = { round: StaffRound; problems: Problem[]; rows: Row[]; review: Review[] };

export function Results({ id }: { id?: string }) {
  const { s, admin } = useStaff();
  const rid = id ?? s.rounds[0]?.id;
  const data = usePoll(() => call<Data>('st_results', { round: rid }), 10000, [rid]);
  const [tab, setTab] = useState<'scores' | 'problems' | 'review'>('scores');
  const [open, setOpen] = useState<string | null>(null);
  const d = data.data;
  const header = (
    <header>
      <div>
        <p className="label-sm">Results</p>
        <h1>{d?.round.title ?? 'Results'}</h1>
        <p>Scores update as answers come in and as you accept answers that aren't in the key. Only staff see this page.</p>
      </div>
      <select className="select" style={{ width: 'auto' }} value={rid} onChange={(e) => go(`staff-results-${e.target.value}`)} aria-label="Round">
        {s.rounds.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
      </select>
    </header>
  );
  if (!d) return <>{header}{data.error ? <ErrorNote error={data.error} onRetry={data.refresh} /> : <PageLoading />}</>;
  const mystery = d.round.kind === 'mystery';
  const team = d.round.kind !== 'individual';
  const pending = d.review.filter((r) => r.ruling === null).length;

  const exportCsv = () => {
    if (mystery) {
      downloadCsv(`${d.round.id}-results.csv`, [['rank', 'team', 'name', 'final', 'rock_bottom', 'right', 'missed', 'patches', 'torpedoes', 'hits_taken'],
        ...d.rows.map((r, i) => [i + 1, r.id, r.name, score1(r.score), r.sunk ? 'yes' : '', r.correct, r.wrong, r.patches, r.torpedoes, r.hits_taken])]);
    } else {
      downloadCsv(`${d.round.id}-results.csv`, [
        ['rank', team ? 'team' : 'student', 'name', ...(team ? [] : ['team']), 'score', 'correct', ...d.problems.map((p) => `p${p.number}`)],
        ...d.rows.map((r, i) => [i + 1, r.id, r.name, ...(team ? [] : [r.team_id]), points(r.score), r.correct, ...d.problems.map((p) => r.answers[p.id]?.raw ?? '')]),
      ]);
    }
  };

  return (
    <>
      {header}
      <div className="spread" style={{ marginBottom: 16 }}>
        <div className="row">
          <StateChip r={d.round} />
          {!mystery && <Seg label="View" value={tab} onChange={setTab} options={[['scores', 'Scores'], ['problems', 'By problem'], ['review', `To review${pending ? ` · ${pending}` : ''}`]]} />}
        </div>
        <Button size="sm" icon="download" onClick={exportCsv}>Export CSV</Button>
      </div>

      {mystery ? (
        <div className="panel"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Team</th><th className="r">Final</th><th className="r">Right</th><th className="r">Missed</th><th className="r">Patches</th><th className="r">Torpedoes</th><th className="r">Hit by</th></tr></thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="mono faint">{i + 1}</td>
                  <td><span className="mono faint">{r.id}</span> {r.name}</td>
                  <td className="r mono" style={{ fontSize: 15 }}>{r.sunk ? <span className="chip chip-bad">0 · Rock Bottom</span> : score1(r.score)}</td>
                  <td className="r mono">{r.correct}</td><td className="r mono">{r.wrong}</td><td className="r mono">{r.patches}</td><td className="r mono">{r.torpedoes}</td><td className="r mono">{r.hits_taken}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div></div>
      ) : tab === 'scores' ? (
        <div className="panel"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>{team ? 'Team' : 'Student'}</th>{!team && <th>Team</th>}<th className="r">Score</th><th className="r">Correct</th><th className="r">Answered</th>{d.round.kind === 'guts' && <th className="r">Sets</th>}{!team && <th className="r">Tab switches</th>}<th /></tr></thead>
            <tbody>
              {d.rows.map((r, i) => (
                <Fragment key={r.id}>
                  <tr style={{ cursor: 'pointer' }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="mono faint">{i + 1}</td>
                    <td><span className="mono faint">{r.id}</span> {r.name}</td>
                    {!team && <td className="muted">{r.team_id} {r.team_name}</td>}
                    <td className="r mono" style={{ fontSize: 15 }}>{points(r.score)}</td>
                    <td className="r mono">{r.correct}</td>
                    <td className="r mono">{r.answered}</td>
                    {d.round.kind === 'guts' && <td className="r mono">{r.sets}</td>}
                    {!team && <td className="r">{r.flags ? <span className="chip chip-live">{r.flags}</span> : ''}</td>}
                    <td className="r"><Icon name={open === r.id ? 'down' : 'right'} size={15} /></td>
                  </tr>
                  {open === r.id && (
                    <tr><td colSpan={9} style={{ background: 'var(--bg-sunk)' }}>
                      <div className="row" style={{ gap: 6 }}>
                        {d.problems.map((p) => {
                          const a = r.answers[p.id];
                          return <span key={p.id} className={`chip ${a ? (a.ok && a.counts !== false ? 'chip-good' : 'chip-bad') : 'chip-outline'} mono`} style={{ textTransform: 'none', letterSpacing: 0 }} title={`Key: ${p.answer}`}>{p.number}: {a?.raw ?? '—'}</span>;
                        })}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div></div>
      ) : tab === 'problems' ? (
        <div className="panel"><div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th>{d.round.kind === 'guts' && <th>Set</th>}<th>Key</th><th style={{ width: '45%' }}>Solved</th></tr></thead>
            <tbody>
              {d.problems.map((p) => {
                const solved = d.rows.filter((r) => r.answers[p.id]?.ok && r.answers[p.id]?.counts !== false).length;
                const tried = d.rows.filter((r) => r.answers[p.id]).length;
                const pct = d.rows.length ? solved / d.rows.length : 0;
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.number}</td>
                    {d.round.kind === 'guts' && <td className="mono faint">{p.set_no}</td>}
                    <td className="mono">{p.answer}</td>
                    <td>
                      <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                        <div style={{ flex: 1, height: 8, borderRadius: 8, background: 'var(--bg-sunk)', overflow: 'hidden' }}><div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--ink)', borderRadius: 8, transition: 'width .6s var(--ease)' }} /></div>
                        <span className="mono" style={{ fontSize: 13, minWidth: 92, textAlign: 'right' }}>{solved}/{d.rows.length} · {tried} tried</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div></div>
      ) : (
        <ReviewList items={d.review} admin={admin} onChange={data.refresh} problems={d.problems} />
      )}
    </>
  );
}

function ReviewList({ items, onChange, problems }: { items: Review[]; admin: boolean; onChange: () => Promise<void>; problems: Problem[] }) {
  const [busy, setBusy] = useState('');
  if (!items.length) return <div className="panel empty"><h3>Nothing to review.</h3><p>Every answer so far either matches the key or is blank.</p></div>;
  const rule = async (r: Review, correct: boolean | null) => {
    setBusy(r.problem_id + r.norm);
    try {
      await call('st_ruling', { problem: r.problem_id, norm: r.norm, correct });
      await onChange();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="panel">
      <div className="panel-head"><h3>Answers not in the key</h3><span className="faint" style={{ fontSize: 13 }}>Accepting one marks everyone who gave it right, now and later.</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Problem</th><th>Key</th><th>Answer given</th><th className="r">How many</th><th>Decision</th><th /></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.problem_id + r.norm}>
                <td className="mono">{r.number}</td>
                <td className="mono faint">{problems.find((p) => p.id === r.problem_id)?.answer}</td>
                <td className="mono">{r.raw}{r.raw.trim().toLowerCase() !== r.norm ? <span className="faint"> → {r.norm}</span> : ''}</td>
                <td className="r mono">{r.count}</td>
                <td>{r.ruling === null ? <span className="chip chip-warn">Wrong unless accepted</span> : r.ruling ? <span className="chip chip-good">Accepted</span> : <span className="chip chip-bad">Confirmed wrong</span>}</td>
                <td className="r" style={{ whiteSpace: 'nowrap' }}>
                  {r.ruling !== true && <Button size="xs" variant="good" busy={busy === r.problem_id + r.norm} onClick={() => rule(r, true)}>Accept</Button>}
                  {r.ruling === null && <Button size="xs" variant="ghost" onClick={() => rule(r, false)}>Wrong</Button>}
                  {r.ruling !== null && <Button size="xs" variant="ghost" onClick={() => rule(r, null)}>Undo</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
