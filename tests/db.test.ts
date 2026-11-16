import { beforeAll, describe, expect, it } from 'vitest';
import { TestDb, T0, type Json } from './db';

let t: TestDb;
let admin: string;
let proctor: string;

const roster = [
  { team_id: '07', team_name: 'Kelp Forest', student_id: '07A', name: 'Ada Park', email: 'ada@example.com' },
  { team_id: '07', team_name: 'Kelp Forest', student_id: '07B', name: 'Ben Ito', email: 'ben@example.com' },
  { team_id: '12', team_name: 'Trench Crew', student_id: '12A', name: 'Cy Diaz', email: 'cy@example.com' },
  { team_id: '15', team_name: 'Anglerfish', student_id: '15A', name: 'Di Rao', email: 'di@example.com' },
];

async function signIn(id: string, email: string) {
  const r = await t.call('s_sign_in', { id, email });
  expect(r.error).toBeUndefined();
  return r.token as string;
}

beforeAll(async () => {
  t = await new TestDb().init();
  admin = await t.admin();
  // Proctor through an invite code.
  const { code } = await t.call('st_staff_change', { action: 'invite', role: 'proctor', name: 'Pat' }, admin);
  proctor = await t.addUser('pat@sfmo.test');
  expect((await t.call('st_redeem', { code: code.toLowerCase(), name: 'Pat' }, proctor)).ok).toBe(true);
  await t.call('st_roster_import', { rows: roster }, admin);
  const prob = (n: number, key: string, set_no = 1, points = 1) => ({ body: `Problem ${n}`, answer: key, keys: [key], set_no, points });
  await t.call('st_problems_save', { round: 'individual', problems: [prob(1, '7'), prob(2, '3/8'), prob(3, '12')] }, admin);
  await t.call('st_problems_save', { round: 'guts', problems: [prob(1, '1', 1, 5), prob(2, '2', 1, 5), prob(3, '3', 2, 8), prob(4, '4', 2, 8)] }, admin);
  await t.call('st_problems_save', { round: 'mystery', problems: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => prob(n, String(n * 11))) }, admin);
});

describe('locked down', () => {
  it('runs the migration twice and seeds the rounds', async () => {
    const rounds = await t.sql<{ id: string }>('select id from rounds order by sort');
    expect(rounds.map((r) => r.id)).toEqual(['practice', 'individual', 'mystery', 'guts']);
  });

  it('gives the browser roles no tables and no helpers', async () => {
    for (const role of ['anon', 'authenticated']) {
      await t.db.exec(`set role ${role}`);
      try {
        await expect(t.db.query('select * from students')).rejects.toThrow(/permission denied/);
        await expect(t.db.query('select * from problems')).rejects.toThrow(/permission denied/);
        await expect(t.db.query(`select _m_apply('mystery','07',now(),'add',100)`)).rejects.toThrow(/permission denied/);
        await expect(t.db.query(`select sfmo_make_admin('x@y.z')`)).rejects.toThrow(/permission denied/);
        await expect(t.db.query(`select _round_wipe('individual')`)).rejects.toThrow(/permission denied/);
        // The API itself is callable.
        const r = await t.db.query<{ r: Json }>(`select s_sign_in('{"id":"nope","email":"x@y.z"}'::jsonb) as r`);
        expect(r.rows[0].r.code).toBe('no_match');
        if (role === 'anon') await expect(t.db.query(`select st_state('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
      } finally {
        await t.db.exec('reset role');
      }
    }
  });
});

describe('student sign-in', () => {
  it('matches ID and email, case-insensitively, and never stores the token', async () => {
    const r = await t.call('s_sign_in', { id: ' 07a ', email: 'ADA@Example.com ' });
    expect(r.student).toMatchObject({ id: '07A', team_id: '07', team_name: 'Kelp Forest' });
    expect(r.token).toMatch(/^[0-9a-f]{64}$/);
    const stored = await t.sql<{ token_hash: string }>('select token_hash from sessions');
    expect(stored.some((s) => s.token_hash === r.token)).toBe(false);
    const home = await t.call('s_home', { token: r.token });
    expect(home.team.members.map((m: Json) => m.id)).toEqual(['07A', '07B']);
    expect(home.rounds).toHaveLength(4);
  });

  it('says the same thing for a wrong email and an unknown ID', async () => {
    const a = await t.call('s_sign_in', { id: '07A', email: 'ben@example.com' });
    const b = await t.call('s_sign_in', { id: '99Z', email: 'ada@example.com' });
    expect(a.error).toBe(b.error);
    expect(a.code).toBe('no_match');
  });

  it('slows down guessing for one ID', async () => {
    for (let i = 0; i < 8; i++) await t.call('s_sign_in', { id: '12A', email: `guess${i}@x.com` });
    expect((await t.call('s_sign_in', { id: '12A', email: 'cy@example.com' })).code).toBe('rate_limited');
    await t.tick(11 * 60);
    expect((await t.call('s_sign_in', { id: '12A', email: 'cy@example.com' })).token).toBeTruthy();
  });

  it('rejects bad, signed-out and paused sessions', async () => {
    expect((await t.fails('s_home', { token: 'abc' })).hint).toBe('signed_out');
    const token = await signIn('07B', 'ben@example.com');
    await t.call('s_sign_out', { token });
    expect((await t.fails('s_home', { token })).hint).toBe('signed_out');
    const again = await signIn('07B', 'ben@example.com');
    await t.call('st_roster_change', { action: 'disable', student_id: '07B' }, proctor);
    expect((await t.fails('s_home', { token: again })).hint).toBe('signed_out');
    expect((await t.call('s_sign_in', { id: '07B', email: 'ben@example.com' })).code).toBe('disabled');
    await t.call('st_roster_change', { action: 'enable', student_id: '07B' }, proctor);
  });

  it('can be closed by staff', async () => {
    await t.call('st_settings_save', { data: { signin_open: false } }, admin);
    expect((await t.call('s_sign_in', { id: '07A', email: 'ada@example.com' })).code).toBe('signin_closed');
    await t.call('st_settings_save', { data: { signin_open: true } }, admin);
  });
});

describe('staff permissions', () => {
  it('keeps non-staff and proctors out of admin work', async () => {
    const stranger = await t.addUser('stranger@x.com');
    expect((await t.fails('st_state', {}, stranger)).hint).toBe('not_staff');
    expect((await t.call('st_me', {}, stranger)).staff).toBeNull();
    expect((await t.fails('st_problems_save', { round: 'individual', problems: [] }, proctor)).hint).toBe('admin_only');
    expect((await t.fails('st_reset', { scope: 'answers', confirm: 'RESET' }, proctor)).hint).toBe('admin_only');
    expect((await t.fails('st_roster_change', { action: 'delete_team', team_id: '07' }, proctor)).hint).toBe('admin_only');
    expect((await t.call('st_state', {}, proctor)).me.role).toBe('proctor');
  });

  it('uses invite codes once, and limits guesses', async () => {
    const { code } = await t.call('st_staff_change', { action: 'invite', role: 'proctor' }, admin);
    const u1 = await t.addUser('one@x.com');
    const u2 = await t.addUser('two@x.com');
    expect((await t.call('st_redeem', { code }, u1)).ok).toBe(true);
    expect((await t.call('st_redeem', { code }, u2)).code).toBe('bad_code');
    for (let i = 0; i < 6; i++) await t.call('st_redeem', { code: `ZZZZ-ZZZZ-ZZZ${i}` }, u2);
    expect((await t.call('st_redeem', { code: 'ZZZZ-ZZZZ-ZZZZ' }, u2)).code).toBe('rate_limited');
  });

  it('never removes the last admin', async () => {
    expect((await t.fails('st_staff_change', { action: 'remove', user_id: admin }, admin)).hint).toBe('last_admin');
    expect((await t.fails('st_staff_change', { action: 'set_role', user_id: admin, role: 'proctor' }, admin)).hint).toBe('last_admin');
  });
});

describe('individual round timing', () => {
  it('hides problems until the round starts, then saves answers until time is up', async () => {
    const token = await signIn('07A', 'ada@example.com');
    let r = await t.call('s_round', { token, round: 'individual' });
    expect(r.round.state).toBe('waiting');
    expect(r.problems).toEqual([]);
    const pid = (await t.sql<{ id: string }>(`select id from problems where round_id = 'individual' order by number`))[1].id;
    expect((await t.fails('s_save', { token, round: 'individual', problem: pid, raw: '3/8', norm: '3/8' })).hint).toBe('closed');

    await t.call('st_round_control', { id: 'individual', action: 'start' }, proctor);
    r = await t.call('s_round', { token, round: 'individual' });
    expect(r.round.state).toBe('open');
    expect(r.problems).toHaveLength(3);
    expect(JSON.stringify(r.problems)).not.toContain('keys');
    expect(r.problems[0].answer).toBeUndefined();
    await t.call('s_save', { token, round: 'individual', problem: pid, raw: ' 3/8 ', norm: '3/8' });
    r = await t.call('s_round', { token, round: 'individual' });
    expect(r.responses[pid].raw).toBe('3/8');

    // Pause: no saves, and the clock stops.
    await t.call('st_round_control', { id: 'individual', action: 'pause' }, proctor);
    expect((await t.fails('s_save', { token, round: 'individual', problem: pid, raw: '1', norm: '1' })).hint).toBe('closed');
    await t.tick(120);
    await t.call('st_round_control', { id: 'individual', action: 'resume' }, proctor);
    r = await t.call('s_round', { token, round: 'individual' });
    expect(Date.parse(r.round.closes_at)).toBe(T0 + 11 * 60_000 + 60 * 60_000 + 120_000);

    // A student with extra time keeps going after everyone else stops.
    await t.call('st_roster_change', { action: 'save_student', student_id: '07B', team_id: '07', name: 'Ben Ito', email: 'ben@example.com', extra_minutes: 10 }, admin);
    const ben = await signIn('07B', 'ben@example.com');
    await t.setClock(Date.parse(r.round.closes_at) + 14_000); // inside the 15 s grace
    await t.call('s_save', { token, round: 'individual', problem: pid, raw: '3/8', norm: '3/8' });
    await t.tick(5);
    expect((await t.fails('s_save', { token, round: 'individual', problem: pid, raw: '1', norm: '1' })).hint).toBe('closed');
    expect((await t.call('s_round', { token, round: 'individual' })).round.state).toBe('closed');
    expect((await t.call('s_round', { token: ben, round: 'individual' })).round.state).toBe('open');
    await t.call('s_save', { token: ben, round: 'individual', problem: pid, raw: '0.375', norm: '3/8' });
  });

  it('grades with keys and rulings, and shows results only when released', async () => {
    const token = await signIn('07A', 'ada@example.com');
    await t.tick(15 * 60);
    let r = await t.call('s_round', { token, round: 'individual' });
    expect(r.round.state).toBe('closed');
    expect(r.problems).toEqual([]);
    const res = await t.call('st_results', { round: 'individual' }, proctor);
    expect(res.rows.find((x: Json) => x.id === '07A').score).toBe(1);
    await t.call('st_round_save', { id: 'individual', show_results: true }, admin);
    r = await t.call('s_round', { token, round: 'individual' });
    expect(r.score).toBe(1);
    expect(r.problems[1]).toMatchObject({ answer: '3/8', correct: true });
  });
});

describe('guts', () => {
  it('locks each set when it is handed in and keeps a live board', async () => {
    const ada = await signIn('07A', 'ada@example.com');
    const cy = await signIn('12A', 'cy@example.com');
    await t.call('st_round_control', { id: 'guts', action: 'start' }, proctor);
    const ids = (await t.sql<{ id: string }>(`select id from problems where round_id = 'guts' order by number`)).map((x) => x.id);
    let r = await t.call('s_round', { token: ada, round: 'guts' });
    expect(r.problems.map((p: Json) => p.set_no)).toEqual([1, 1]);
    expect((await t.fails('s_save', { token: ada, round: 'guts', problem: ids[2], raw: '3', norm: '3' })).hint).toBe('set_locked');
    await t.call('s_save', { token: ada, round: 'guts', problem: ids[0], raw: '1', norm: '1' });
    await t.call('s_save', { token: ada, round: 'guts', problem: ids[1], raw: '9', norm: '9' });
    const sub = await t.call('s_guts_submit', { token: ada, round: 'guts', set: 1 });
    expect(sub).toMatchObject({ correct: 1, points: 5 });
    // A teammate double-clicking is harmless.
    expect((await t.call('s_guts_submit', { token: ada, round: 'guts', set: 1 })).already).toBe(true);
    expect((await t.fails('s_save', { token: ada, round: 'guts', problem: ids[1], raw: '2', norm: '2' })).hint).toBe('set_locked');
    r = await t.call('s_round', { token: ada, round: 'guts' });
    expect(r.problems.map((p: Json) => p.set_no)).toEqual([1, 1, 2, 2]);
    expect(r.board[0]).toMatchObject({ id: '07', score: 5, sets: 1 });
    expect(r.board.find((b: Json) => b.id === '12').score).toBe(0);
    // Another team's answers are theirs alone.
    const cyRound = await t.call('s_round', { token: cy, round: 'guts' });
    expect(Object.keys(cyRound.responses)).toEqual([]);
  });
});

describe('mystery dive', () => {
  const board = async (token: string) => {
    const m = await t.call('s_mystery', { token });
    return Object.fromEntries(m.board.map((b: Json) => [b.id, b])) as Record<string, Json>;
  };
  let ada: string, cy: string, di: string;
  let q: string[];

  beforeAll(async () => {
    ada = await signIn('07A', 'ada@example.com');
    cy = await signIn('12A', 'cy@example.com');
    di = await signIn('15A', 'di@example.com');
    q = (await t.sql<{ id: string }>(`select id from problems where round_id = 'mystery' order by number`)).map((x) => x.id);
    await t.call('st_round_control', { id: 'mystery', action: 'start' }, proctor);
  });

  it('starts everyone at 200 and sinks them at the set rate', async () => {
    let b = await board(ada);
    expect(b['07'].score).toBe(200);
    expect(b['07'].rate).toBe(0.1);
    await t.tick(100);
    b = await board(ada);
    expect(b['07'].score).toBeCloseTo(190, 6);
    expect(b['12'].score).toBeCloseTo(190, 6);
  });

  it('gives one try per question and one hit per correct answer', async () => {
    const wrong = await t.call('s_mystery_answer', { token: ada, problem: q[0], raw: '12', norm: '12' });
    expect(wrong.correct).toBe(false);
    expect((await t.fails('s_mystery_answer', { token: ada, problem: q[0], raw: '11', norm: '11' })).hint).toBe('answered');
    const right = await t.call('s_mystery_answer', { token: ada, problem: q[1], raw: '22', norm: '22' });
    expect(right.correct).toBe(true);
    // Must spend it before answering again.
    expect((await t.fails('s_mystery_answer', { token: ada, problem: q[2], raw: '33', norm: '33' })).hint).toBe('pending');
    const m = await t.call('s_mystery', { token: ada });
    expect(m.pending).toBe(q[1]);
    expect(m.answers[q[0]].correct).toBe(false);
  });

  it('patches +20 and torpedoes -10, and the feed names the attacker', async () => {
    await t.tick(10); // 189
    const patch = await t.call('s_mystery_spend', { token: ada, action: 'patch' });
    expect(patch.result.after).toBeCloseTo(209, 6);
    expect((await t.fails('s_mystery_spend', { token: ada, action: 'patch' })).hint).toBe('no_hit');
    await t.call('s_mystery_answer', { token: ada, problem: q[2], raw: '33', norm: '33' });
    expect((await t.fails('s_mystery_spend', { token: ada, action: 'torpedo', target: '07' })).message).toMatch(/own/);
    const torp = await t.call('s_mystery_spend', { token: ada, action: 'torpedo', target: '12' });
    expect(torp.result.after).toBeCloseTo(179, 6);
    const m = await t.call('s_mystery', { token: cy });
    const hit = m.feed.find((f: Json) => f.kind === 'torpedo');
    expect(hit).toMatchObject({ team_id: '07', target_id: '12', delta: -10 });
    // Wrong answers stay private to the team.
    expect(m.feed.some((f: Json) => f.kind === 'wrong' || f.kind === 'correct')).toBe(false);
  });

  it('hides attackers when the round is set to anonymous', async () => {
    await t.call('st_round_save', { id: 'mystery', config: { anonymous_attacks: true } }, admin);
    const m = await t.call('s_mystery', { token: cy });
    expect(m.feed.find((f: Json) => f.kind === 'torpedo').team_id).toBeNull();
    const mine = await t.call('s_mystery', { token: ada });
    expect(mine.feed.find((f: Json) => f.kind === 'torpedo').team_id).toBe('07');
    await t.call('st_round_save', { id: 'mystery', config: { anonymous_attacks: false } }, admin);
  });

  it('applies modifiers over exactly their window', async () => {
    // 07 = 209 at this moment. Sink x3 for 20 s, then normal.
    await t.call('st_mystery_event', { type: 'mod', mod_kind: 'sink', factor: 3, seconds: 20, targets: ['07'], label: 'Leak' }, proctor);
    await t.tick(30);
    const b = await board(ada);
    expect(b['07'].score).toBeCloseTo(209 - 0.3 * 20 - 0.1 * 10, 6);
    expect(b['12'].score).toBeCloseTo(179 - 0.1 * 30, 6);
    // Double torpedoes for everyone, and armor for 15.
    await t.call('st_mystery_event', { type: 'mod', mod_kind: 'torpedo', factor: 2, seconds: 60, targets: ['all'], label: 'Frenzy' }, proctor);
    await t.call('st_mystery_event', { type: 'mod', mod_kind: 'armor', factor: 0, seconds: 60, targets: ['15'], label: 'Shield' }, proctor);
    await t.call('s_mystery_answer', { token: cy, problem: q[0], raw: '11', norm: '11' });
    const r1 = await t.call('s_mystery_spend', { token: cy, action: 'torpedo', target: '15' });
    expect(r1.value).toBe(0);
    await t.call('s_mystery_answer', { token: cy, problem: q[1], raw: '22', norm: '22' });
    const r2 = await t.call('s_mystery_spend', { token: cy, action: 'torpedo', target: '07' });
    expect(r2.value).toBe(20);
  });

  it('sends a team to Rock Bottom for good, except for Salvage', async () => {
    const before = (await board(di))['15'].score;
    await t.call('st_mystery_event', { type: 'add', value: -100, targets: ['15'], label: 'NUKE' }, proctor);
    await t.call('st_mystery_event', { type: 'add', value: -100, targets: ['15'], label: 'NUKE' }, proctor);
    let b = await board(di);
    expect(before).toBeGreaterThan(100);
    expect(b['15']).toMatchObject({ score: 0, sunk: true });
    // Staff "add" can't lift a sunk team either.
    await t.call('st_mystery_event', { type: 'add', value: 50, targets: ['15'], label: 'Gift' }, proctor);
    expect((await board(di))['15'].score).toBe(0);
    // Can still answer and fire, but not patch, and can't be targeted.
    await t.call('s_mystery_answer', { token: di, problem: q[0], raw: '11', norm: '11' });
    expect((await t.fails('s_mystery_spend', { token: di, action: 'patch' })).hint).toBe('sunk');
    expect((await t.fails('s_mystery_spend', { token: di, action: 'discard' })).hint).toBe('invalid');
    await t.call('s_mystery_spend', { token: di, action: 'torpedo', target: '12' });
    await t.call('s_mystery_answer', { token: ada, problem: q[3], raw: '44', norm: '44' });
    expect((await t.fails('s_mystery_spend', { token: ada, action: 'torpedo', target: '15' })).hint).toBe('target_sunk');
    await t.call('s_mystery_spend', { token: ada, action: 'patch' });
    // Salvage: every sunk team back to 10, nobody else touched.
    const others = await board(ada);
    const s = await t.call('st_mystery_event', { type: 'salvage', targets: ['all'], label: "Non-trivial's Salvage" }, proctor);
    expect(s.targets).toEqual(['15']);
    b = await board(ada);
    expect(b['15']).toMatchObject({ score: 10, sunk: false });
    expect(b['07'].score).toBeCloseTo(others['07'].score, 6);
    const sunkLogs = await t.sql(`select * from mystery_log where kind = 'sunk' and team_id = '15'`);
    expect(sunkLogs).toHaveLength(1);
  });

  it('notices a team drifting to the bottom, once, at the right moment', async () => {
    // 15 is at 10 and sinks at 0.1/s: zero after 100 s.
    await t.tick(250);
    const m = await t.call('s_mystery', { token: ada });
    await t.call('s_mystery', { token: cy });
    const sunk = m.board.find((b: Json) => b.id === '15');
    expect(sunk.sunk).toBe(true);
    const logs = await t.sql<{ at: string }>(`select at from mystery_log where kind = 'sunk' and team_id = '15' order by id`);
    expect(logs).toHaveLength(2);
    expect(new Date(logs[1].at).getTime() - t.now).toBe(-150_000);
  });

  it('freezes while paused and ends at the close', async () => {
    const before = (await board(ada))['07'].score;
    await t.call('st_round_control', { id: 'mystery', action: 'pause' }, proctor);
    expect((await t.fails('s_mystery_answer', { token: ada, problem: q[4], raw: '55', norm: '55' })).hint).toBe('closed');
    await t.tick(300);
    expect((await board(ada))['07'].score).toBeCloseTo(before, 6);
    await t.call('st_round_control', { id: 'mystery', action: 'resume' }, proctor);
    await t.tick(10);
    expect((await board(ada))['07'].score).toBeCloseTo(before - 1, 6);
    await t.call('st_round_control', { id: 'mystery', action: 'close' }, proctor);
    const final = (await board(ada))['07'].score;
    await t.tick(600);
    expect((await board(ada))['07'].score).toBeCloseTo(final, 6);
    expect((await t.fails('s_mystery_answer', { token: ada, problem: q[4], raw: '55', norm: '55' })).hint).toBe('closed');
    const res = await t.call('st_results', { round: 'mystery' }, proctor);
    expect(res.rows[0].id).toBe('07');
    expect(res.rows.find((x: Json) => x.id === '15')).toMatchObject({ score: 0, sunk: true });
  });

  it('a reset wipes the round so it can run again', async () => {
    await t.call('st_round_control', { id: 'mystery', action: 'reset' }, admin);
    const b = await board(ada);
    expect(b['15']).toMatchObject({ score: 200, sunk: false });
    expect((await t.sql(`select count(*)::int as n from mystery_answers`))[0].n).toBe(0);
  });
});

describe('resets and roster', () => {
  it('signs everyone out, then empties the roster', async () => {
    const token = await signIn('07A', 'ada@example.com');
    await t.call('st_reset', { scope: 'sessions', confirm: 'RESET' }, admin);
    expect((await t.fails('s_home', { token })).hint).toBe('signed_out');
    expect((await t.fails('st_reset', { scope: 'roster', confirm: 'yes' }, admin)).message).toMatch(/RESET/);
    await t.call('st_reset', { scope: 'roster', confirm: 'RESET' }, admin);
    expect((await t.call('st_roster', {}, proctor)).teams).toEqual([]);
  });

  it('rejects bad roster rows with the row number', async () => {
    const e = await t.fails('st_roster_import', { rows: [roster[0], { ...roster[1], email: 'nope' }] }, admin);
    expect(e.message).toMatch(/Row 2/);
    expect((await t.call('st_roster', {}, proctor)).teams).toEqual([]);
  });

  it('factory reset keeps staff and re-seeds rounds', async () => {
    await t.call('st_reset', { scope: 'everything', confirm: 'RESET' }, admin);
    const s = await t.call('st_state', {}, admin);
    expect(s.rounds).toHaveLength(4);
    expect(s.me.role).toBe('admin');
  });
});

describe('live rule changes', () => {
  it('changing the sinking speed mid-dive only applies from then on', async () => {
    const t2 = await new TestDb().init();
    const a = await t2.admin();
    await t2.call('st_roster_import', { rows: roster }, a);
    await t2.call('st_problems_save', { round: 'mystery', problems: [{ body: 'x', answer: '1', keys: ['1'] }] }, a);
    await t2.call('st_round_control', { id: 'mystery', action: 'start' }, a);
    await t2.tick(100); // 190
    await t2.call('st_round_save', { id: 'mystery', config: { sink_rate: 1 } }, a);
    const b1 = await t2.call('st_mystery', {}, a);
    expect(b1.board.find((x: Json) => x.id === '07').score).toBeCloseTo(190, 6);
    await t2.tick(10);
    const b2 = await t2.call('st_mystery', {}, a);
    expect(b2.board.find((x: Json) => x.id === '07').score).toBeCloseTo(180, 6);
  });
});
