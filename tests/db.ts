// A throwaway database for tests: PGlite running the real migration, with a
// clock the test controls.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const STUB = readFileSync(`${root}/supabase/tests/stub_auth.sql`, 'utf8');
export const MIGRATION = readFileSync(`${root}/supabase/migrations/0001_sfmo.sql`, 'utf8');

export const T0 = Date.parse('2027-01-16T17:00:00Z');

export type Json = Record<string, any>;

export class TestDb {
  db = new PGlite();
  now = T0;

  async init() {
    await this.db.exec(STUB);
    await this.db.exec(MIGRATION);
    await this.db.exec(MIGRATION); // running it twice must be harmless
    await this.db.exec(`
      create table if not exists test_clock (t timestamptz not null);
      create or replace function sfmo_now() returns timestamptz language sql stable as $$ select t from test_clock limit 1 $$;
    `);
    await this.setClock(T0);
    return this;
  }

  async setClock(ms: number) {
    this.now = ms;
    await this.db.query('delete from test_clock');
    await this.db.query('insert into test_clock (t) values ($1)', [new Date(ms).toISOString()]);
  }

  async tick(seconds: number) {
    await this.setClock(this.now + seconds * 1000);
  }

  /** Calls an API function as a given auth user (or anonymous), like PostgREST would. */
  async call<T = Json>(fn: string, p: Json = {}, uid?: string): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      const res = await tx.query<{ r: T }>(`select ${fn}($1::jsonb) as r`, [JSON.stringify(p)]);
      return res.rows[0].r;
    });
  }

  async fails(fn: string, p: Json = {}, uid?: string): Promise<{ message: string; hint?: string }> {
    try {
      await this.call(fn, p, uid);
    } catch (e: any) {
      return { message: e.message, hint: e.hint };
    }
    throw new Error(`${fn} should have failed`);
  }

  async sql<T = Json>(q: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(q, params)).rows;
  }

  async addUser(email: string) {
    const id = crypto.randomUUID();
    await this.db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    return id;
  }

  async admin() {
    const id = await this.addUser(`admin${Math.random().toString(36).slice(2, 6)}@sfmo.test`);
    const email = (await this.sql<{ email: string }>('select email from auth.users where id = $1', [id]))[0].email;
    await this.sql('select sfmo_make_admin($1)', [email]);
    return id;
  }
}
