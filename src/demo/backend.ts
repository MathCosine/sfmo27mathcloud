/**
 * The demo: the real database functions running in this browser tab (PGlite),
 * seeded with twelve teams, with bot teams playing the live rounds. Nothing
 * leaves the page; reloading starts a fresh contest.
 */
import { PGlite } from '@electric-sql/pglite';
import stub from '../../supabase/tests/stub_auth.sql?raw';
import migration from '../../supabase/migrations/0001_sfmo.sql?raw';
import { ApiError, type Backend, type StaffUser } from '../lib/api';
import { keysFor, normalize } from '../lib/answers';
import { GUTS, GUTS_POINTS, INDIVIDUAL, MYSTERY, PRACTICE, type DemoProblem } from './problems';

import { DEMO_PASSWORD, DEMO_STAFF, DEMO_STUDENT } from './constants';

const TEAMS: [string, string, string[]][] = [
  ['03', 'Bathysphere', ['Maya Chen', 'Leo Okafor', 'Sana Mirza']],
  ['05', 'Riptide', ['Owen Brooks', 'Isla Fernández', 'Kenji Mori', 'Ruth Abebe']],
  ['07', 'Kelp Forest', ['Ada Park', 'Ben Ito', 'Chloe Varga']],
  ['09', 'Anglerfish', ['Dev Patel', 'Nora Lindqvist', 'Tomás Rivera', 'Grace Wu']],
  ['12', 'Trench Crew', ['Cyrus Diaz', 'Amara Nwosu', 'Felix Huang']],
  ['14', 'Nautilus', ['Priya Raman', 'Jonah Weiss', 'Lena Kowalski', 'Sam Tran']],
  ['16', 'Tidepool', ['Ethan Cho', 'Mira Shah', 'Theo Grant']],
  ['18', 'Lanternfish', ['Zoe Martin', 'Arjun Iyer', 'Hana Sato', 'Will Osei']],
  ['21', 'Mariana', ['Lucas Silva', 'Ivy Zhang', 'Omar Haddad']],
  ['23', 'Coral Reef', ['Ella Novak', 'Ravi Kumar', 'June Park', 'Max Becker']],
  ['25', 'Sea Otters', ['Aiden Lee', 'Sofia Russo', 'Kai Yamamoto']],
  ['28', 'Deep Blue', ['Nina Petrov', 'Eli Jacobs', 'Rosa Medina', 'Finn Walsh']],
];
const ME_TEAM = '07';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(xs: T[]) => xs[rand(xs.length)];

type Q = (sql: string, params?: unknown[]) => Promise<any[]>;

async function seed(db: PGlite) {
  const q: Q = async (sql, params = []) => (await db.query(sql, params)).rows as any[];
  // A clock the seed can wind back, so the live rounds start with some history.
  await db.exec(`
    create table if not exists demo_clock (t timestamptz);
    create or replace function sfmo_now() returns timestamptz language sql stable as $$ select coalesce((select t from demo_clock limit 1), now()) $$;
  `);
  for (const s of DEMO_STAFF) {
    await q('insert into auth.users (id, email) values ($1, $2) on conflict do nothing', [s.id, s.email]);
    await q('insert into staff (user_id, email, name, role) values ($1, $2, $3, $4) on conflict do nothing', [s.id, s.email, s.name, s.role]);
  }
  await q(`update settings set data = data || $1::jsonb`, [JSON.stringify({ zoom_url: 'https://zoom.us/j/95550127027', public_boards: true })]);

  for (const [id, name, members] of TEAMS) {
    await q('insert into teams (id, name) values ($1, $2)', [id, name]);
    for (let i = 0; i < members.length; i++) {
      const sid = id + 'ABCD'[i];
      const email = sid === DEMO_STUDENT.id ? DEMO_STUDENT.email : `${members[i].split(' ')[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.${sid.toLowerCase()}@example.com`;
      await q('insert into students (id, team_id, name, email) values ($1, $2, $3, $4)', [sid, id, members[i], email]);
    }
  }

  const put = async (round: string, list: DemoProblem[], points: (i: number) => number, set: (i: number) => number) => {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      await q('insert into problems (round_id, number, set_no, points, body, answer, keys) values ($1, $2, $3, $4, $5, $6, $7)',
        [round, i + 1, set(i), points(i), p.text, p.answers.join(' | '), keysFor(p.answers)]);
    }
  };
  await put('practice', PRACTICE, () => 1, () => 1);
  await put('individual', INDIVIDUAL, () => 1, () => 1);
  await put('mystery', MYSTERY, () => 1, () => 1);
  await put('guts', GUTS.flat(), (i) => GUTS_POINTS[Math.floor(i / 4)], (i) => Math.floor(i / 4) + 1);

  const now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  await q(`update rounds set opens_at = $1, closes_at = $2, minutes = 720 where id = 'practice'`, [at(60), at(-660)]);
  await q(`update rounds set opens_at = $1, closes_at = $2, scheduled_at = $1 where id = 'individual'`, [at(6), at(-54)]);
  await q(`update rounds set opens_at = $1, closes_at = $2, scheduled_at = $1 where id = 'mystery'`, [at(5), at(-40)]);
  await q(`update rounds set opens_at = $1, closes_at = $2, scheduled_at = $1 where id = 'guts'`, [at(3), at(-57)]);
  await q(`insert into announcements (at, text, tone, by_staff) values ($1, $2, 'info', 'Priya Nand')`,
    [at(9), 'Welcome! Cameras on, desks visible. Rounds open on the clock in the corner.']);
  await q(`insert into announcements (at, text, tone, round_id, by_staff) values ($1, $2, 'info', 'individual', 'Jordan Lee')`,
    [at(2), 'Individual, problem 7: "probability" means as a common fraction or decimal; both are accepted.']);
}

/** Bots: one signed-in student per team except yours. */
class Bots {
  tokens = new Map<string, string>();
  skill = new Map<string, number>();
  constructor(private db: PGlite) {}

  async api(fn: string, p: object): Promise<any> {
    const r = await this.db.query<{ r: any }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
    return r.rows[0].r;
  }

  async init() {
    for (const [id] of TEAMS) {
      if (id === ME_TEAM) continue;
      const s = (await this.db.query<{ id: string; email: string }>(`select id, email from students where team_id = $1 order by id limit 1`, [id])).rows[0];
      const r = await this.api('s_sign_in', { id: s.id, email: s.email });
      this.tokens.set(id, r.token);
      this.skill.set(id, 0.45 + Math.random() * 0.45);
    }
  }

  async mysteryTurn(team: string) {
    const token = this.tokens.get(team)!;
    const m = await this.api('s_mystery', { token });
    if (m.round.state !== 'open') return;
    if (m.pending) return this.spend(team, m);
    const open = (m.problems ?? []).filter((p: any) => !m.answers[p.id]);
    if (!open.length) return;
    const p = pick(open) as any;
    const key = (await this.db.query<{ answer: string; keys: string[] }>('select answer, keys from problems where id = $1', [p.id])).rows[0];
    const right = Math.random() < this.skill.get(team)!;
    const raw = right ? key.answer : String((Number(key.answer) || 7) + pick([-2, -1, 1, 3]));
    const r = await this.api('s_mystery_answer', { token, problem: p.id, raw, norm: normalize(raw) });
    if (r.correct) await this.spend(team, await this.api('s_mystery', { token }));
  }

  async spend(team: string, m: any) {
    const token = this.tokens.get(team)!;
    const me = m.board.find((b: any) => b.id === team);
    const targets = m.board.filter((b: any) => b.id !== team && !b.sunk).sort((a: any, b: any) => b.score - a.score);
    const attack = me?.sunk || (me.score > 150 && Math.random() < 0.7) || Math.random() < 0.3;
    if (attack && targets.length) {
      // Mostly go after the leaders; sometimes hold a grudge against Kelp Forest.
      const target = Math.random() < 0.18 ? targets.find((t: any) => t.id === ME_TEAM) ?? targets[0] : targets[Math.min(rand(3), targets.length - 1)];
      await this.api('s_mystery_spend', { token, action: 'torpedo', target: target.id });
    } else if (!me?.sunk) {
      await this.api('s_mystery_spend', { token, action: 'patch' });
    }
  }

  async gutsTurn(team: string) {
    const token = this.tokens.get(team)!;
    const r = await this.api('s_round', { token, round: 'guts' });
    if (r.round.state !== 'open') return;
    const current = r.problems.filter((p: any) => p.set_no === r.sets_done + 1);
    if (!current.length) return;
    for (const p of current) {
      const key = (await this.db.query<{ answer: string }>('select answer from problems where id = $1', [p.id])).rows[0].answer;
      const raw = Math.random() < this.skill.get(team)! ? key : String((Number(key) || 3) + 1);
      await this.api('s_save', { token, round: 'guts', problem: p.id, raw, norm: normalize(raw) });
    }
    await this.api('s_guts_submit', { token, round: 'guts', set: r.sets_done + 1 });
  }

  /** Replays the first minutes of the live rounds so the boards have a story. */
  async history() {
    const opens = Date.now() - 5 * 60_000;
    for (let s = 20; s < 300; s += 9 + rand(8)) {
      await this.db.query('delete from demo_clock');
      await this.db.query('insert into demo_clock values ($1)', [new Date(opens + s * 1000).toISOString()]);
      await this.mysteryTurn(pick([...this.tokens.keys()])).catch(() => {});
      if (s > 120 && Math.random() < 0.35) await this.gutsTurn(pick([...this.tokens.keys()])).catch(() => {});
    }
    // One proctor event early on, so the feed shows what events look like.
    await this.db.query('delete from demo_clock');
    await this.db.query('insert into demo_clock values ($1)', [new Date(opens + 150_000).toISOString()]);
    await this.db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [DEMO_STAFF[1].id]);
    await this.api('st_mystery_event', { type: 'mod', mod_kind: 'sink', factor: 2, seconds: 45, targets: ['all'], label: 'Riptide', message: 'Strong current: everyone sinks twice as fast for 45 seconds.', icon: 'wave' }).catch(() => {});
    await this.db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await this.db.query('delete from demo_clock');
  }

  start(lock: <T>(f: () => Promise<T>) => Promise<T>) {
    const loop = async () => {
      const team = pick([...this.tokens.keys()]);
      await lock(() => this.mysteryTurn(team)).catch(() => {});
      if (Math.random() < 0.22) await lock(() => this.gutsTurn(pick([...this.tokens.keys()]))).catch(() => {});
      setTimeout(loop, 2600 + rand(3200));
    };
    setTimeout(loop, 2500);
  }
}

export async function createDemoBackend(): Promise<Backend> {
  const t0 = performance.now();
  const mark = (what: string) => import.meta.env.DEV && console.debug(`[demo] ${what} ${Math.round(performance.now() - t0)} ms`);
  const db = await PGlite.create();
  mark('pglite');
  await db.exec(stub);
  await db.exec(migration);
  mark('schema');
  await seed(db);
  mark('seed');
  const bots = new Bots(db);
  await bots.init();
  await bots.history();
  mark('history');

  // One request at a time, like a connection pool of one.
  let chain: Promise<unknown> = Promise.resolve();
  const lock = <T,>(f: () => Promise<T>): Promise<T> => {
    const next = chain.then(f, f);
    chain = next.catch(() => {});
    return next;
  };
  bots.start(lock);

  let user: StaffUser | null = null;
  try {
    const saved = sessionStorage.getItem('sfmo27-demo-staff');
    if (saved) user = JSON.parse(saved);
  } catch {
    /* no storage: start signed out */
  }
  const remember = () => {
    try {
      if (user) sessionStorage.setItem('sfmo27-demo-staff', JSON.stringify(user));
      else sessionStorage.removeItem('sfmo27-demo-staff');
    } catch {
      /* ignore */
    }
  };

  return {
    kind: 'demo',
    async call(fn, p) {
      if (!/^(s|st|public)_[a-z_]+$/.test(fn)) throw new ApiError('Unknown function.', 'invalid');
      await delay(60 + rand(140));
      return lock(async () => {
        try {
          return await db.transaction(async (tx) => {
            await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user?.id ?? '']);
            const r = await tx.query<{ r: unknown }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
            return r.rows[0].r;
          });
        } catch (e: any) {
          throw new ApiError(e?.message ?? 'Something went wrong.', e?.hint || 'error');
        }
      });
    },
    staff: {
      async current() {
        return user;
      },
      async signIn(email, password) {
        await delay(300);
        const row = (await db.query<{ id: string; email: string }>('select id, email from auth.users where lower(email) = lower($1)', [email.trim()])).rows[0];
        if (!row || password !== DEMO_PASSWORD) throw new ApiError(`In the demo, use ${DEMO_STAFF[0].email} or ${DEMO_STAFF[1].email} with the password "${DEMO_PASSWORD}".`, 'auth');
        user = { id: row.id, email: row.email };
        remember();
      },
      async signUp(email) {
        await delay(300);
        const id = crypto.randomUUID();
        await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email.trim().toLowerCase()]);
        user = { id, email: email.trim().toLowerCase() };
        remember();
        return { confirm: false };
      },
      async signOut() {
        user = null;
        remember();
      },
      async resetPassword() {
        await delay(300);
      },
      async updatePassword() {
        await delay(200);
      },
    },
  };
}
