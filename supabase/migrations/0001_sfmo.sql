-- SFMO 2027 Online: the whole backend.
--
-- The browser never touches a table. Every read and write is one of the
-- functions below (s_* for students, st_* for staff, public_board for the
-- projector). Tables have row level security switched on with no policies, so
-- the REST API returns nothing for them, and only the API functions are
-- executable by the anon/authenticated roles (see the grants at the end).
--
-- Students sign in with their ID and the email they registered with and get a
-- random session token; only its SHA-256 is stored. Staff are Supabase Auth
-- users bound to a row in `staff` by an invite code (or sfmo_make_admin for the
-- first admin, run in the SQL editor).
--
-- Safe to run again: everything is create-if-missing or create-or-replace.

-- ---------------------------------------------------------------- clock

-- One place that says what time it is. Tests replace it with a fake clock.
create or replace function sfmo_now() returns timestamptz language sql stable as $$ select now() $$;

-- ---------------------------------------------------------------- tables

create table if not exists settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists teams (
  id text primary key check (id ~ '^[A-Z0-9_-]{1,16}$'),
  name text not null check (length(name) between 1 and 80),
  room_url text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists students (
  id text primary key check (id ~ '^[A-Z0-9_-]{1,16}$'),
  team_id text not null references teams(id) on delete cascade on update cascade,
  name text not null check (length(name) between 1 and 100),
  email text not null check (length(email) between 3 and 200),
  extra_minutes int not null default 0 check (extra_minutes between 0 and 600),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists students_team on students(team_id);

create table if not exists sessions (
  token_hash text primary key,
  student_id text not null references students(id) on delete cascade on update cascade,
  created_at timestamptz not null,
  last_seen timestamptz not null,
  expires_at timestamptz not null,
  agent text not null default ''
);
create index if not exists sessions_student on sessions(student_id);

create table if not exists signin_failures (
  student_id text not null,
  at timestamptz not null
);
create index if not exists signin_failures_id on signin_failures(student_id, at);

create table if not exists rounds (
  id text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
  kind text not null check (kind in ('individual', 'guts', 'mystery')),
  title text not null check (length(title) between 1 and 80),
  blurb text not null default '',
  rules text not null default '',
  sort int not null default 0,
  minutes int not null default 60 check (minutes between 1 and 720),
  grace_seconds int not null default 15 check (grace_seconds between 0 and 300),
  scheduled_at timestamptz,
  opens_at timestamptz,
  closes_at timestamptz,
  paused_at timestamptz,
  visible boolean not null default true,
  show_results boolean not null default false,
  config jsonb not null default '{}'::jsonb
);

create table if not exists problems (
  id uuid primary key default gen_random_uuid(),
  round_id text not null references rounds(id) on delete cascade on update cascade,
  number int not null,
  set_no int not null default 1 check (set_no between 1 and 50),
  points double precision not null default 1,
  body text not null default '',
  answer text not null default '',
  keys text[] not null default '{}',
  unique (round_id, number)
);

-- Individual rounds: entrant is a student id. Team rounds: a team id.
create table if not exists responses (
  round_id text not null references rounds(id) on delete cascade on update cascade,
  entrant_id text not null,
  problem_id uuid not null references problems(id) on delete cascade,
  raw text not null,
  norm text not null,
  by_student text,
  saved_at timestamptz not null,
  primary key (entrant_id, problem_id)
);
create index if not exists responses_round on responses(round_id);

create table if not exists guts_sets (
  round_id text not null references rounds(id) on delete cascade on update cascade,
  team_id text not null references teams(id) on delete cascade on update cascade,
  set_no int not null,
  submitted_at timestamptz not null,
  by_student text,
  primary key (round_id, team_id, set_no)
);

-- A staff decision that an answer not in the key is right (or confirmed wrong).
create table if not exists rulings (
  problem_id uuid not null references problems(id) on delete cascade,
  norm text not null,
  correct boolean not null,
  by_staff text,
  at timestamptz not null,
  primary key (problem_id, norm)
);

-- Mystery Dive. A team's depth is stored as a snapshot (score at a moment);
-- between snapshots it sinks at the round's rate times any active modifiers.
create table if not exists mystery_subs (
  round_id text not null references rounds(id) on delete cascade on update cascade,
  team_id text not null references teams(id) on delete cascade on update cascade,
  score double precision not null,
  at timestamptz not null,
  sunk boolean not null default false,
  sunk_at timestamptz,
  primary key (round_id, team_id)
);

-- sink: multiplies how fast a team sinks (0 freezes, negative rises)
-- patch: multiplies what a team's patch is worth
-- torpedo: multiplies the damage a team's torpedoes do
-- armor: multiplies the damage a team takes from torpedoes
-- Modifiers only ever start now or later, and only ever end now or later, so
-- the past never changes and snapshots stay valid.
create table if not exists mystery_mods (
  id bigserial primary key,
  round_id text not null references rounds(id) on delete cascade on update cascade,
  kind text not null check (kind in ('sink', 'patch', 'torpedo', 'armor')),
  factor double precision not null,
  team_id text references teams(id) on delete cascade on update cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  label text not null default '',
  hidden boolean not null default false
);
create index if not exists mystery_mods_round on mystery_mods(round_id, kind);

-- One try per question per team. A correct answer is a "hit" the team spends
-- on a patch or a torpedo before answering anything else.
create table if not exists mystery_answers (
  round_id text not null references rounds(id) on delete cascade on update cascade,
  team_id text not null references teams(id) on delete cascade on update cascade,
  problem_id uuid not null references problems(id) on delete cascade,
  raw text not null,
  norm text not null,
  correct boolean not null,
  at timestamptz not null,
  by_student text,
  spent_as text check (spent_as in ('patch', 'torpedo', 'discard')),
  spent_at timestamptz,
  target_id text,
  primary key (round_id, team_id, problem_id)
);

create table if not exists mystery_log (
  id bigserial primary key,
  round_id text not null references rounds(id) on delete cascade on update cascade,
  at timestamptz not null,
  kind text not null,
  team_id text,
  target_id text,
  targets text[],
  problem_id uuid,
  delta double precision,
  score_after double precision,
  label text,
  message text,
  public boolean not null default true,
  by_student text,
  by_staff text,
  meta jsonb
);
create index if not exists mystery_log_round on mystery_log(round_id, id);

create table if not exists announcements (
  id bigserial primary key,
  at timestamptz not null,
  text text not null check (length(text) between 1 and 1000),
  tone text not null default 'info' check (tone in ('info', 'urgent')),
  round_id text references rounds(id) on delete cascade on update cascade,
  by_staff text
);

create table if not exists integrity (
  id bigserial primary key,
  at timestamptz not null,
  round_id text not null references rounds(id) on delete cascade on update cascade,
  student_id text not null references students(id) on delete cascade on update cascade,
  kind text not null,
  ms int not null default 0
);
create index if not exists integrity_round on integrity(round_id, student_id);

create table if not exists staff (
  user_id uuid primary key,
  email text not null default '',
  name text not null default '',
  role text not null check (role in ('admin', 'proctor')),
  created_at timestamptz not null default now()
);

create table if not exists staff_invites (
  code text primary key,
  role text not null check (role in ('admin', 'proctor')),
  name text not null default '',
  created_by text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_by uuid,
  used_at timestamptz
);

create table if not exists staff_failures (
  user_id uuid not null,
  at timestamptz not null
);

create table if not exists audit (
  id bigserial primary key,
  at timestamptz not null,
  actor text,
  action text not null,
  detail jsonb
);

do $$
declare t text;
begin
  foreach t in array array['settings','teams','students','sessions','signin_failures','rounds','problems','responses',
    'guts_sets','rulings','mystery_subs','mystery_mods','mystery_answers','mystery_log','announcements','integrity',
    'staff','staff_invites','staff_failures','audit']
  loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on table %I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- defaults

create or replace function _default_settings() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'event_name', 'SFMO 2027',
    'event_subtitle', 'Online division',
    'event_date', '2027-01-16',
    'timezone', 'America/Los_Angeles',
    'welcome', 'Welcome to the online division of the San Francisco Math Open. Keep your camera on in Zoom and this tab in front of you during every round.',
    'help_text', 'Something not working? Tell your proctor in Zoom chat. Your answers are saved as you type.',
    'contact_email', 'hello@sfmathopen.org',
    'zoom_url', '',
    'signin_open', true,
    'signin_closed_message', 'Sign-in opens on contest morning.',
    'public_boards', false,
    'integrity', 'warn',
    'session_hours', 16,
    'show_teammates', true
  )
$$;

insert into settings (id, data) values (1, _default_settings()) on conflict (id) do nothing;

create or replace function _seed_rounds() returns void language plpgsql as $$
begin
  insert into rounds (id, kind, title, blurb, rules, sort, minutes, grace_seconds, config) values
  ('practice', 'individual', 'Practice', 'Try the test screen before the day. Nothing here counts.',
   'Three warm-up problems so you can see how answers save. Nothing here counts toward your score.', 0, 15, 15, '{}'::jsonb),
  ('individual', 'individual', 'Individual', 'Twenty short-answer problems, on your own.',
   'Work alone. No calculators, notes or other tabs; pencil and paper are fine. Answers save as you type, and you can change them until time runs out. Give exact answers: integers, or fractions in lowest terms.', 1, 60, 15, '{}'::jsonb),
  ('mystery', 'mystery', 'Mystery Dive', 'A live team round. Keep your submarine off the sea floor.',
   'Your team''s submarine starts at 200 and sinks every second. Every question gets one try. Get one right and you choose: patch your hull, or fire a torpedo at another team. Hit 0 and you are at Rock Bottom: you can still fire torpedoes, but your score can never rise again, and the round scores 0 for you unless something brings you back.', 2, 45, 5,
   jsonb_build_object('start', 200, 'sink_rate', 0.1, 'patch', 20, 'torpedo', 10, 'salvage', 10, 'show_board', true, 'anonymous_attacks', false, 'allow_hit_sunk', false)),
  ('guts', 'guts', 'Guts', 'Sets of four, against the clock, on a live board.',
   'Hand in a set to see the next one; you cannot go back. Later sets are worth more. Anyone on your team can type in any box, and everyone sees the latest answer.', 3, 60, 10,
   jsonb_build_object('show_board', true, 'reveal_set_scores', true))
  on conflict (id) do nothing;
end $$;
select _seed_rounds();

-- ---------------------------------------------------------------- helpers

create or replace function _fail(msg text, code text default 'error') returns void language plpgsql as $$
begin
  raise exception '%', msg using errcode = 'P0001', hint = code;
end $$;

create or replace function _hash(t text) returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex')
$$;

create or replace function _as_uuid(t text) returns uuid language plpgsql immutable as $$
begin
  if t is null or t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  return t::uuid;
end $$;

create or replace function _log_audit(p_actor text, p_action text, p_detail jsonb default null) returns void language sql as $$
  insert into audit (at, actor, action, detail) values (sfmo_now(), p_actor, p_action, p_detail)
$$;

create or replace function _cfg() returns jsonb language sql stable as $$
  select _default_settings() || coalesce((select data from settings where id = 1), '{}'::jsonb)
$$;

-- The student behind a session token, or an error that sends them to sign in.
create or replace function _auth(p jsonb) returns students language plpgsql as $$
declare
  v_hash text := _hash(p->>'token');
  v_student students;
begin
  if coalesce(p->>'token', '') = '' then perform _fail('Sign in to continue.', 'signed_out'); end if;
  select st.* into v_student
    from sessions se join students st on st.id = se.student_id
   where se.token_hash = v_hash and se.expires_at > sfmo_now();
  if not found then perform _fail('Your session has ended. Sign in again.', 'signed_out'); end if;
  if v_student.disabled then perform _fail('This account has been paused by a proctor.', 'disabled'); end if;
  update sessions set last_seen = sfmo_now()
   where token_hash = v_hash and last_seen < sfmo_now() - interval '10 seconds';
  return v_student;
end $$;

create or replace function _require_staff(p_min_role text default 'proctor') returns staff language plpgsql as $$
declare v_staff staff;
begin
  if auth.uid() is null then perform _fail('Sign in as staff to continue.', 'signed_out'); end if;
  select * into v_staff from staff where user_id = auth.uid();
  if not found then perform _fail('This account is not on the staff list.', 'not_staff'); end if;
  if p_min_role = 'admin' and v_staff.role <> 'admin' then
    perform _fail('Only admins can do that.', 'admin_only');
  end if;
  return v_staff;
end $$;

create or replace function _staff_label(s staff) returns text language sql immutable as $$
  select coalesce(nullif(s.name, ''), nullif(s.email, ''), s.user_id::text)
$$;

create or replace function _state(r rounds, p_at timestamptz, p_extra int default 0) returns text language sql stable as $$
  select case
    when r.opens_at is null or p_at < r.opens_at then 'waiting'
    when r.paused_at is not null then 'paused'
    when p_at <= r.closes_at + make_interval(mins => p_extra) then 'open'
    else 'closed' end
$$;

-- Saves are accepted while open, plus a few seconds of grace for answers in flight.
create or replace function _writable(r rounds, p_at timestamptz, p_extra int default 0) returns text language sql stable as $$
  select case
    when r.opens_at is null or p_at < r.opens_at then 'This round hasn''t started yet.'
    when r.paused_at is not null then 'The round is paused. Hold on; your answers are safe.'
    when p_at > r.closes_at + make_interval(mins => p_extra) + make_interval(secs => r.grace_seconds) then 'Time''s up. This round is closed.'
    else null end
$$;

create or replace function _extra(r rounds, s students) returns int language sql immutable as $$
  select case when r.kind = 'individual' then s.extra_minutes else 0 end
$$;

create or replace function _round_pub(r rounds, p_at timestamptz, p_extra int default 0) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'title', r.title, 'blurb', r.blurb, 'rules', r.rules,
    'minutes', r.minutes + p_extra, 'scheduled_at', r.scheduled_at, 'opens_at', r.opens_at,
    'closes_at', r.closes_at + make_interval(mins => p_extra),
    'paused', r.paused_at is not null, 'paused_at', r.paused_at,
    'state', _state(r, p_at, p_extra), 'show_results', r.show_results, 'sort', r.sort,
    'config', r.config,
    'problem_count', (select count(*) from problems where round_id = r.id),
    'set_count', (select coalesce(max(set_no), 0) from problems where round_id = r.id))
$$;

create or replace function _round_staff(r rounds, p_at timestamptz) returns jsonb language sql stable as $$
  select _round_pub(r, p_at) || jsonb_build_object(
    'visible', r.visible, 'grace_seconds', r.grace_seconds, 'minutes', r.minutes,
    'keys_missing', (select count(*) from problems where round_id = r.id and cardinality(keys) = 0),
    'entrants', (select count(distinct entrant_id) from responses where round_id = r.id)
              + (select count(distinct team_id) from mystery_answers where round_id = r.id),
    'responses', (select count(*) from responses where round_id = r.id)
               + (select count(*) from mystery_answers where round_id = r.id))
$$;

create or replace function _ok(p_problem uuid, p_keys text[], p_norm text) returns boolean language sql stable as $$
  select coalesce(p_norm, '') <> '' and (p_norm = any(p_keys)
    or exists (select 1 from rulings where problem_id = p_problem and norm = p_norm and correct))
$$;

create or replace function _anns(p jsonb, p_round text default null) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'text', a.text, 'tone', a.tone, 'round_id', a.round_id) order by a.id desc), '[]'::jsonb)
  from (select * from announcements
         where id > coalesce(nullif(p->>'ann_since', '')::bigint, 0)
           and (round_id is null or p_round is null or round_id = p_round)
         order by id desc limit 15) a
$$;

create or replace function _student_pub(s students) returns jsonb language sql stable as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'team_id', s.team_id,
    'team_name', (select name from teams where id = s.team_id))
$$;

-- ---------------------------------------------------------------- mystery engine

-- Score after sinking from (s0 at t0) to t1 for one team, given the round's
-- base sink rate and every sink modifier (arrays, global ones have a null team).
-- Returns the score at t1, or the moment it reached zero.
create or replace function _m_adv(
  p_team text, s0 double precision, t0 timestamptz, t1 timestamptz, base double precision,
  mt text[], ms timestamptz[], me timestamptz[], mf double precision[],
  out score double precision, out sunk_at timestamptz
) language plpgsql immutable as $$
declare
  t timestamptz := t0;
  b timestamptz;
  s double precision := s0;
  rate double precision;
  dt double precision;
  n int := coalesce(array_length(ms, 1), 0);
  i int;
begin
  sunk_at := null;
  while t < t1 loop
    b := t1;
    rate := base;
    for i in 1..n loop
      if mt[i] is not null and mt[i] <> p_team then continue; end if;
      if ms[i] > t and ms[i] < b then b := ms[i]; end if;
      if me[i] is not null and me[i] > t and me[i] < b then b := me[i]; end if;
      if ms[i] <= t and (me[i] is null or me[i] > t) then rate := rate * mf[i]; end if;
    end loop;
    dt := extract(epoch from (b - t))::double precision;
    if rate > 0 and s - rate * dt <= 0 then
      sunk_at := t + make_interval(secs => s / rate);
      score := 0;
      return;
    end if;
    s := s - rate * dt;
    t := b;
  end loop;
  score := s;
end $$;

create or replace function _m_rate(
  p_team text, p_at timestamptz, base double precision,
  mt text[], ms timestamptz[], me timestamptz[], mf double precision[]
) returns double precision language plpgsql immutable as $$
declare rate double precision := base; i int;
begin
  for i in 1..coalesce(array_length(ms, 1), 0) loop
    if mt[i] is not null and mt[i] <> p_team then continue; end if;
    if ms[i] <= p_at and (me[i] is null or me[i] > p_at) then rate := rate * mf[i]; end if;
  end loop;
  return rate;
end $$;

-- Product of the active patch/torpedo/armor modifiers for a team.
create or replace function _m_factor(p_round text, p_kind text, p_team text, p_at timestamptz) returns double precision
language plpgsql stable as $$
declare v double precision := 1; f double precision;
begin
  for f in select factor from mystery_mods
            where round_id = p_round and kind = p_kind and (team_id is null or team_id = p_team)
              and starts_at <= p_at and (ends_at is null or ends_at > p_at)
  loop v := v * f; end loop;
  return v;
end $$;

create or replace function _m_cfg(r rounds, p_key text, p_default double precision) returns double precision language sql immutable as $$
  select coalesce((r.config->>p_key)::double precision, p_default)
$$;

-- Records that a team drifted to zero, unless its snapshot changed meanwhile.
create or replace function _m_mark_sunk(p_round text, p_team text, p_sunk_at timestamptz, p_seen_at timestamptz) returns void
language plpgsql as $$
declare v_start double precision;
begin
  if p_seen_at is null then
    select _m_cfg(r, 'start', 200) into v_start from rounds r where id = p_round;
    insert into mystery_subs (round_id, team_id, score, at, sunk, sunk_at)
    values (p_round, p_team, 0, p_sunk_at, true, p_sunk_at)
    on conflict (round_id, team_id) do nothing;
    if not found then return; end if;
  else
    update mystery_subs set score = 0, at = p_sunk_at, sunk = true, sunk_at = p_sunk_at
     where round_id = p_round and team_id = p_team and not sunk and at = p_seen_at;
    if not found then return; end if;
  end if;
  insert into mystery_log (round_id, at, kind, team_id, score_after, public)
  values (p_round, p_sunk_at, 'sunk', p_team, 0, true);
end $$;

-- Every team's depth right now (or at the close), computed in memory.
create or replace function _m_board(p_round text, p_at timestamptz, p_persist boolean default true) returns jsonb
language plpgsql as $$
declare
  r rounds;
  v_base double precision;
  v_start double precision;
  v_t1 timestamptz;
  mt text[]; ms timestamptz[]; me timestamptz[]; mf double precision[];
  rec record;
  res record;
  v_out jsonb := '[]'::jsonb;
  v_rate double precision;
begin
  select * into r from rounds where id = p_round;
  v_base := _m_cfg(r, 'sink_rate', 0.1);
  v_start := _m_cfg(r, 'start', 200);
  if r.opens_at is null then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'score', v_start, 'rate', 0, 'sunk', false) order by t.id), '[]'::jsonb) from teams t);
  end if;
  select coalesce(array_agg(team_id order by id), '{}'), coalesce(array_agg(starts_at order by id), '{}'),
         coalesce(array_agg(ends_at order by id), '{}'), coalesce(array_agg(factor order by id), '{}')
    into mt, ms, me, mf
    from mystery_mods where round_id = p_round and kind = 'sink';
  v_t1 := greatest(r.opens_at, least(p_at, r.closes_at));
  for rec in
    select t.id, t.name, s.score, s.at, s.sunk, s.sunk_at
      from teams t left join mystery_subs s on s.round_id = p_round and s.team_id = t.id
     order by t.id
  loop
    if rec.sunk then
      v_out := v_out || jsonb_build_object('id', rec.id, 'name', rec.name, 'score', 0, 'rate', 0, 'sunk', true, 'sunk_at', rec.sunk_at);
      continue;
    end if;
    select * into res from _m_adv(rec.id, coalesce(rec.score, v_start), coalesce(rec.at, r.opens_at), greatest(v_t1, coalesce(rec.at, r.opens_at)), v_base, mt, ms, me, mf);
    if res.sunk_at is not null then
      if p_persist then perform _m_mark_sunk(p_round, rec.id, res.sunk_at, rec.at); end if;
      v_out := v_out || jsonb_build_object('id', rec.id, 'name', rec.name, 'score', 0, 'rate', 0, 'sunk', true, 'sunk_at', res.sunk_at);
    else
      v_rate := case when p_at >= r.closes_at or r.paused_at is not null then 0 else _m_rate(rec.id, v_t1, v_base, mt, ms, me, mf) end;
      v_out := v_out || jsonb_build_object('id', rec.id, 'name', rec.name, 'score', res.score, 'rate', v_rate, 'sunk', false);
    end if;
  end loop;
  return v_out;
end $$;

-- Lock (creating if needed) the snapshots of these teams, in a fixed order so
-- two teams torpedoing each other cannot deadlock.
create or replace function _m_lock(p_round text, p_teams text[]) returns void language plpgsql as $$
declare r rounds;
begin
  select * into r from rounds where id = p_round;
  insert into mystery_subs (round_id, team_id, score, at)
  select p_round, t, _m_cfg(r, 'start', 200), coalesce(r.opens_at, sfmo_now())
    from unnest(p_teams) t
   where exists (select 1 from teams where id = t)
  on conflict (round_id, team_id) do nothing;
  perform 1 from mystery_subs where round_id = p_round and team_id = any(p_teams) order by team_id for update;
end $$;

-- Change one team's score at p_at. Mode: add | set | revive.
-- A team at Rock Bottom ignores add; set and revive (staff, Salvage) bring it back.
-- Caller must hold the lock (_m_lock).
create or replace function _m_apply(p_round text, p_team text, p_at timestamptz, p_mode text, p_value double precision)
returns jsonb language plpgsql as $$
declare
  r rounds;
  sub mystery_subs;
  v_at timestamptz;
  mt text[]; ms timestamptz[]; me timestamptz[]; mf double precision[];
  res record;
  v_before double precision;
  v_was_sunk boolean;
  v_sunk_at timestamptz;
  v_new double precision;
  v_new_sunk boolean;
begin
  select * into r from rounds where id = p_round;
  select * into sub from mystery_subs where round_id = p_round and team_id = p_team for update;
  v_at := greatest(sub.at, least(p_at, coalesce(r.closes_at, p_at)));
  if sub.sunk then
    v_was_sunk := true; v_before := 0; v_sunk_at := sub.sunk_at;
  else
    select coalesce(array_agg(team_id order by id), '{}'), coalesce(array_agg(starts_at order by id), '{}'),
           coalesce(array_agg(ends_at order by id), '{}'), coalesce(array_agg(factor order by id), '{}')
      into mt, ms, me, mf
      from mystery_mods where round_id = p_round and kind = 'sink';
    select * into res from _m_adv(p_team, sub.score, sub.at, v_at, _m_cfg(r, 'sink_rate', 0.1), mt, ms, me, mf);
    if res.sunk_at is not null then
      v_was_sunk := true; v_before := 0; v_sunk_at := res.sunk_at;
      insert into mystery_log (round_id, at, kind, team_id, score_after, public) values (p_round, res.sunk_at, 'sunk', p_team, 0, true);
    else
      v_was_sunk := false; v_before := res.score;
    end if;
  end if;

  if v_was_sunk then
    v_new := case when p_mode in ('set', 'revive') then p_value else 0 end;
  else
    v_new := case when p_mode = 'add' then v_before + p_value else p_value end;
  end if;
  v_new_sunk := v_new <= 0;
  if v_new_sunk then
    v_new := 0;
    if not v_was_sunk or p_mode in ('set', 'revive') then
      v_sunk_at := v_at;
      insert into mystery_log (round_id, at, kind, team_id, score_after, public) values (p_round, v_at, 'sunk', p_team, 0, true);
    end if;
  else
    v_sunk_at := null;
  end if;

  update mystery_subs set score = v_new, at = v_at, sunk = v_new_sunk, sunk_at = v_sunk_at
   where round_id = p_round and team_id = p_team;
  return jsonb_build_object('team', p_team, 'before', v_before, 'after', v_new, 'was_sunk', v_was_sunk, 'sunk', v_new_sunk);
end $$;

-- Current depth of one team without writing anything.
create or replace function _m_peek(p_round text, p_team text, p_at timestamptz) returns jsonb language plpgsql as $$
declare b jsonb;
begin
  select e into b from jsonb_array_elements(_m_board(p_round, p_at, false)) e where e->>'id' = p_team;
  return b;
end $$;

create or replace function _m_feed(p_round text, p_since bigint, p_viewer_team text, p_staff boolean) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', l.id, 'at', l.at, 'kind', l.kind,
      'team_id', case
        when l.kind = 'torpedo' and not p_staff and coalesce((r.config->>'anonymous_attacks')::boolean, false)
             and l.team_id is distinct from p_viewer_team then null
        else l.team_id end,
      'target_id', l.target_id, 'targets', l.targets, 'delta', l.delta, 'score_after', l.score_after,
      'label', l.label, 'message', l.message, 'public', l.public,
      'problem_id', case when p_staff then l.problem_id end,
      'by', case when p_staff then coalesce(l.by_staff, l.by_student) end,
      'meta', case when p_staff then l.meta else l.meta - 'affected' end) x
    from (select * from mystery_log
           where round_id = p_round and id > coalesce(p_since, 0)
             and (p_staff or public or team_id = p_viewer_team)
           order by id desc limit case when p_staff then 400 else 80 end) l
    join rounds r on r.id = l.round_id
  ) q
$$;

create or replace function _m_mods(p_round text, p_at timestamptz, p_staff boolean) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'factor', factor, 'team_id', team_id,
    'starts_at', starts_at, 'ends_at', ends_at, 'label', label) order by id), '[]'::jsonb)
  from mystery_mods
  where round_id = p_round and starts_at <= p_at and (ends_at is null or ends_at > p_at)
    and (p_staff or not hidden)
$$;

-- ---------------------------------------------------------------- student API

create or replace function s_sign_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id text := upper(btrim(coalesce(p->>'id', '')));
  v_email text := lower(btrim(coalesce(p->>'email', '')));
  v_cfg jsonb := _cfg();
  v_student students;
  v_token text;
  v_fails int;
begin
  if not coalesce((v_cfg->>'signin_open')::boolean, true) then
    return jsonb_build_object('error', coalesce(nullif(v_cfg->>'signin_closed_message', ''), 'Sign-in is closed right now.'), 'code', 'signin_closed');
  end if;
  if v_id = '' or v_email = '' then
    return jsonb_build_object('error', 'Enter your student ID and your email.', 'code', 'invalid');
  end if;
  v_id := left(v_id, 32);
  select count(*) into v_fails from signin_failures where student_id = v_id and at > sfmo_now() - interval '10 minutes';
  if v_fails >= 8 then
    return jsonb_build_object('error', 'Too many tries for this ID. Wait ten minutes, or ask your proctor.', 'code', 'rate_limited');
  end if;
  select * into v_student from students where id = v_id and lower(btrim(email)) = left(v_email, 200);
  if not found then
    -- Kept: this function returns instead of raising, so the failure is recorded.
    insert into signin_failures (student_id, at) values (v_id, sfmo_now());
    return jsonb_build_object('error', 'That ID and email don''t match our roster. Check both, or ask your proctor.', 'code', 'no_match');
  end if;
  if v_student.disabled then
    return jsonb_build_object('error', 'This account has been paused. Ask your proctor.', 'code', 'disabled');
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into sessions (token_hash, student_id, created_at, last_seen, expires_at, agent)
  values (_hash(v_token), v_student.id, sfmo_now(), sfmo_now(),
          sfmo_now() + make_interval(hours => greatest(1, least(72, coalesce((v_cfg->>'session_hours')::int, 16)))),
          left(coalesce(p->>'agent', ''), 200));
  delete from signin_failures where student_id = v_id or at < sfmo_now() - interval '1 hour';
  delete from sessions where expires_at < sfmo_now() - interval '1 day';
  return jsonb_build_object('token', v_token, 'student', _student_pub(v_student), 'now', sfmo_now());
end $$;

-- What the sign-in page shows before anyone signs in: the event and its schedule.
create or replace function s_info(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cfg jsonb := _cfg();
begin
  return jsonb_build_object(
    'now', sfmo_now(),
    'settings', jsonb_build_object(
      'event_name', v_cfg->'event_name', 'event_subtitle', v_cfg->'event_subtitle', 'event_date', v_cfg->'event_date',
      'timezone', v_cfg->'timezone', 'signin_open', v_cfg->'signin_open', 'signin_closed_message', v_cfg->'signin_closed_message',
      'contact_email', v_cfg->'contact_email', 'public_boards', v_cfg->'public_boards'),
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'scheduled_at', coalesce(r.scheduled_at, r.opens_at),
                 'minutes', r.minutes, 'state', _state(r, sfmo_now())) order by r.sort, r.id), '[]'::jsonb)
               from rounds r where r.visible));
end $$;

create or replace function s_sign_out(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from sessions where token_hash = _hash(p->>'token');
  return jsonb_build_object('ok', true);
end $$;

create or replace function _progress(r rounds, s students) returns jsonb language sql stable as $$
  select case r.kind
    when 'individual' then jsonb_build_object('answered', (select count(*) from responses where round_id = r.id and entrant_id = s.id))
    when 'guts' then jsonb_build_object(
      'answered', (select count(*) from responses where round_id = r.id and entrant_id = s.team_id),
      'sets_done', (select count(*) from guts_sets where round_id = r.id and team_id = s.team_id))
    else jsonb_build_object('answered', (select count(*) from mystery_answers where round_id = r.id and team_id = s.team_id))
  end
$$;

create or replace function s_home(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  v_cfg jsonb := _cfg();
  v_team teams;
begin
  select * into v_team from teams where id = v_student.team_id;
  return jsonb_build_object(
    'now', v_now,
    'me', _student_pub(v_student),
    'team', jsonb_build_object(
      'id', v_team.id, 'name', v_team.name,
      'room_url', coalesce(nullif(v_team.room_url, ''), nullif(v_cfg->>'zoom_url', '')),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name,
          'online', exists (select 1 from sessions se where se.student_id = m.id and se.last_seen > v_now - interval '45 seconds' and se.expires_at > v_now))
          order by m.id), '[]'::jsonb)
        from students m where m.team_id = v_team.id and not m.disabled)),
    'settings', v_cfg - 'session_hours',
    'rounds', (select coalesce(jsonb_agg(_round_pub(r, v_now, _extra(r, v_student)) || jsonb_build_object('progress', _progress(r, v_student)) order by r.sort, r.id), '[]'::jsonb)
                 from rounds r where r.visible),
    'announcements', _anns(p));
end $$;

create or replace function s_round(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_extra int;
  v_state text;
  v_entrant text;
  v_done int := 0;
  v_show boolean;
  v_review boolean;
begin
  select * into r from rounds where id = p->>'round' and visible;
  if not found then perform _fail('That round doesn''t exist.', 'not_found'); end if;
  v_extra := _extra(r, v_student);
  v_state := _state(r, v_now, v_extra);
  v_entrant := case when r.kind = 'individual' then v_student.id else v_student.team_id end;
  if r.kind = 'guts' then
    select count(*) into v_done from guts_sets where round_id = r.id and team_id = v_student.team_id;
  end if;
  v_show := v_state in ('open', 'paused') and r.kind <> 'mystery';
  v_review := v_state = 'closed' and r.show_results and r.kind <> 'mystery';
  return jsonb_build_object(
    'now', v_now,
    'round', _round_pub(r, v_now, v_extra),
    'me', _student_pub(v_student),
    'sets_done', v_done,
    'problems', case when v_show or v_review then (
      select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'number', pr.number, 'set_no', pr.set_no, 'points', pr.points, 'body', pr.body)
               || case when v_review then jsonb_build_object('answer', pr.answer, 'correct',
                    _ok(pr.id, pr.keys, (select norm from responses where entrant_id = v_entrant and problem_id = pr.id))) else '{}'::jsonb end
               order by pr.number), '[]'::jsonb)
        from problems pr
       where pr.round_id = r.id and (r.kind <> 'guts' or v_review or pr.set_no <= v_done + 1)) else '[]'::jsonb end,
    'responses', (select coalesce(jsonb_object_agg(rs.problem_id, jsonb_build_object('raw', rs.raw, 'by', rs.by_student, 'at', rs.saved_at)), '{}'::jsonb)
                    from responses rs where rs.round_id = r.id and rs.entrant_id = v_entrant),
    'score', case when v_review then (
      select coalesce(sum(pr.points), 0) from responses rs join problems pr on pr.id = rs.problem_id
       where rs.round_id = r.id and rs.entrant_id = v_entrant and _ok(pr.id, pr.keys, rs.norm)
         and (r.kind <> 'guts' or pr.set_no <= v_done)) end,
    'board', case when r.kind = 'guts' and v_state <> 'waiting' and coalesce((r.config->>'show_board')::boolean, true)
                  then _guts_board(r.id) end,
    'announcements', _anns(p, r.id));
end $$;

create or replace function s_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_problem problems;
  v_entrant text;
  v_why text;
  v_done int;
  v_raw text := left(btrim(coalesce(p->>'raw', '')), 200);
  v_norm text := left(coalesce(p->>'norm', ''), 200);
begin
  select * into r from rounds where id = p->>'round' and visible;
  if not found or r.kind = 'mystery' then perform _fail('That round doesn''t take saved answers.', 'not_found'); end if;
  select * into v_problem from problems where id = _as_uuid(p->>'problem') and round_id = r.id;
  if not found then perform _fail('That problem isn''t in this round.', 'not_found'); end if;
  v_why := _writable(r, v_now, _extra(r, v_student));
  if v_why is not null then perform _fail(v_why, 'closed'); end if;
  v_entrant := case when r.kind = 'individual' then v_student.id else v_student.team_id end;
  if r.kind = 'guts' then
    -- Serialise with set hand-ins so nothing changes in a set after it is handed in.
    perform pg_advisory_xact_lock(hashtext('guts:' || r.id || ':' || v_student.team_id));
    select count(*) into v_done from guts_sets where round_id = r.id and team_id = v_student.team_id;
    if v_problem.set_no <> v_done + 1 then
      perform _fail(case when v_problem.set_no <= v_done then 'That set has already been handed in.' else 'That set isn''t open yet.' end, 'set_locked');
    end if;
  end if;
  if v_raw = '' then
    delete from responses where entrant_id = v_entrant and problem_id = v_problem.id;
  else
    insert into responses (round_id, entrant_id, problem_id, raw, norm, by_student, saved_at)
    values (r.id, v_entrant, v_problem.id, v_raw, v_norm, v_student.id, v_now)
    on conflict (entrant_id, problem_id) do update
      set raw = excluded.raw, norm = excluded.norm, by_student = excluded.by_student, saved_at = excluded.saved_at;
  end if;
  return jsonb_build_object('saved_at', v_now, 'now', v_now);
end $$;

create or replace function s_guts_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_set int := nullif(p->>'set', '')::int;
  v_done int;
  v_total int;
  v_why text;
  v_correct int;
  v_points double precision;
begin
  select * into r from rounds where id = p->>'round' and visible and kind = 'guts';
  if not found then perform _fail('That isn''t a Guts round.', 'not_found'); end if;
  v_why := _writable(r, v_now);
  if v_why is not null then perform _fail(v_why, 'closed'); end if;
  perform pg_advisory_xact_lock(hashtext('guts:' || r.id || ':' || v_student.team_id));
  select count(*) into v_done from guts_sets where round_id = r.id and team_id = v_student.team_id;
  select coalesce(max(set_no), 0) into v_total from problems where round_id = r.id;
  if v_set is null or v_set <> v_done + 1 then
    if v_set is not null and v_set <= v_done then
      return jsonb_build_object('set', v_set, 'already', true, 'sets_done', v_done, 'now', v_now);
    end if;
    perform _fail('That set isn''t open.', 'set_locked');
  end if;
  if v_set > v_total then perform _fail('There are no more sets.', 'set_locked'); end if;
  insert into guts_sets (round_id, team_id, set_no, submitted_at, by_student) values (r.id, v_student.team_id, v_set, v_now, v_student.id);
  select count(*) filter (where _ok(pr.id, pr.keys, rs.norm)), coalesce(sum(pr.points) filter (where _ok(pr.id, pr.keys, rs.norm)), 0)
    into v_correct, v_points
    from problems pr left join responses rs on rs.problem_id = pr.id and rs.entrant_id = v_student.team_id
   where pr.round_id = r.id and pr.set_no = v_set;
  return jsonb_build_object('set', v_set, 'sets_done', v_set, 'now', v_now,
    'correct', case when coalesce((r.config->>'reveal_set_scores')::boolean, true) then v_correct end,
    'points', case when coalesce((r.config->>'reveal_set_scores')::boolean, true) then v_points end);
end $$;

create or replace function _guts_board(p_round text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by (x->>'score')::double precision desc, (x->>'sets')::int desc, x->>'last_at' nulls last, x->>'id'), '[]'::jsonb) from (
    select jsonb_build_object('id', t.id, 'name', t.name,
      'sets', (select count(*) from guts_sets g where g.round_id = p_round and g.team_id = t.id),
      'last_at', (select max(submitted_at) from guts_sets g where g.round_id = p_round and g.team_id = t.id),
      'score', coalesce((select sum(pr.points)
          from responses rs
          join problems pr on pr.id = rs.problem_id
          join guts_sets g on g.round_id = p_round and g.team_id = t.id and g.set_no = pr.set_no
         where rs.entrant_id = t.id and pr.round_id = p_round and _ok(pr.id, pr.keys, rs.norm)), 0)) x
    from teams t) q
$$;

create or replace function s_flag(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_kind text := left(coalesce(p->>'kind', ''), 24);
  v_round text := p->>'round';
begin
  if v_kind not in ('hidden', 'blur', 'fullscreen_exit', 'paste', 'resize', 'second_device') then return jsonb_build_object('ok', false); end if;
  if not exists (select 1 from rounds where id = v_round) then return jsonb_build_object('ok', false); end if;
  if (select count(*) from integrity where round_id = v_round and student_id = v_student.id) < 400 then
    insert into integrity (at, round_id, student_id, kind, ms)
    values (sfmo_now(), v_round, v_student.id, v_kind, greatest(0, least(86400000, coalesce(nullif(p->>'ms', '')::int, 0))));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- student API: Mystery Dive

create or replace function _m_live(r rounds, p_at timestamptz, p_grace boolean) returns text language sql stable as $$
  select case
    when r.opens_at is null or p_at < r.opens_at then 'The dive hasn''t started yet.'
    when r.paused_at is not null then 'The dive is paused. Hold on.'
    when p_at > r.closes_at + make_interval(secs => case when p_grace then r.grace_seconds else 0 end) then 'The dive is over.'
    else null end
$$;

create or replace function s_mystery(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_state text;
  v_board jsonb;
  v_show_board boolean;
begin
  select * into r from rounds where id = coalesce(p->>'round', 'mystery') and visible and kind = 'mystery';
  if not found then perform _fail('There is no Mystery Dive here.', 'not_found'); end if;
  v_state := _state(r, v_now);
  v_board := _m_board(r.id, v_now, true);
  v_show_board := coalesce((r.config->>'show_board')::boolean, true);
  if not v_show_board then
    select coalesce(jsonb_agg(case when e->>'id' = v_student.team_id then e
             else jsonb_build_object('id', e->'id', 'name', e->'name', 'sunk', e->'sunk') end), '[]'::jsonb)
      into v_board from jsonb_array_elements(v_board) e;
  end if;
  return jsonb_build_object(
    'now', v_now,
    'round', _round_pub(r, v_now),
    'me', _student_pub(v_student),
    'board', v_board,
    'feed', _m_feed(r.id, nullif(p->>'since', '')::bigint, v_student.team_id, false),
    'mods', _m_mods(r.id, v_now, false),
    'answers', (select coalesce(jsonb_object_agg(a.problem_id, jsonb_build_object('correct', a.correct, 'spent_as', a.spent_as, 'target_id', a.target_id, 'by', a.by_student, 'at', a.at)), '{}'::jsonb)
                  from mystery_answers a where a.round_id = r.id and a.team_id = v_student.team_id),
    'pending', (select a.problem_id from mystery_answers a
                 where a.round_id = r.id and a.team_id = v_student.team_id and a.correct and a.spent_as is null
                 order by a.at limit 1),
    'values', jsonb_build_object(
      'patch', _m_cfg(r, 'patch', 20) * _m_factor(r.id, 'patch', v_student.team_id, v_now),
      'torpedo', _m_cfg(r, 'torpedo', 10) * _m_factor(r.id, 'torpedo', v_student.team_id, v_now)),
    'problems', case when v_state in ('open', 'paused') and coalesce((p->>'with_problems')::boolean, true) then (
      select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'number', pr.number, 'points', pr.points, 'body', pr.body) order by pr.number), '[]'::jsonb)
        from problems pr where pr.round_id = r.id) end,
    'announcements', _anns(p, r.id));
end $$;

create or replace function s_mystery_answer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_problem problems;
  v_why text;
  v_raw text := left(btrim(coalesce(p->>'raw', '')), 200);
  v_norm text := left(coalesce(p->>'norm', ''), 200);
  v_correct boolean;
begin
  select * into r from rounds where id = coalesce(p->>'round', 'mystery') and visible and kind = 'mystery';
  if not found then perform _fail('There is no Mystery Dive here.', 'not_found'); end if;
  v_why := _m_live(r, v_now, false);
  if v_why is not null then perform _fail(v_why, 'closed'); end if;
  select * into v_problem from problems where id = _as_uuid(p->>'problem') and round_id = r.id;
  if not found then perform _fail('That question isn''t in this round.', 'not_found'); end if;
  if v_raw = '' or v_norm = '' then perform _fail('Type an answer first.', 'invalid'); end if;
  perform _m_lock(r.id, array[v_student.team_id]);
  if exists (select 1 from mystery_answers where round_id = r.id and team_id = v_student.team_id and correct and spent_as is null) then
    perform _fail('Your team has a hit to use first: patch or torpedo.', 'pending');
  end if;
  if exists (select 1 from mystery_answers where round_id = r.id and team_id = v_student.team_id and problem_id = v_problem.id) then
    perform _fail('Your team already answered this one.', 'answered');
  end if;
  v_correct := v_norm = any(v_problem.keys);
  insert into mystery_answers (round_id, team_id, problem_id, raw, norm, correct, at, by_student)
  values (r.id, v_student.team_id, v_problem.id, v_raw, v_norm, v_correct, v_now, v_student.id);
  insert into mystery_log (round_id, at, kind, team_id, problem_id, public, by_student, meta)
  values (r.id, v_now, case when v_correct then 'correct' else 'wrong' end, v_student.team_id, v_problem.id, false, v_student.id,
          jsonb_build_object('number', v_problem.number, 'raw', v_raw));
  return jsonb_build_object('correct', v_correct, 'problem', v_problem.id, 'now', v_now);
end $$;

create or replace function s_mystery_spend(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student students := _auth(p);
  v_now timestamptz := sfmo_now();
  r rounds;
  v_action text := coalesce(p->>'action', '');
  v_target text := nullif(upper(btrim(coalesce(p->>'target', ''))), '');
  v_why text;
  v_answer mystery_answers;
  v_value double precision;
  v_res jsonb;
  v_mine jsonb;
  v_floating int;
begin
  select * into r from rounds where id = coalesce(p->>'round', 'mystery') and visible and kind = 'mystery';
  if not found then perform _fail('There is no Mystery Dive here.', 'not_found'); end if;
  v_why := _m_live(r, v_now, true);
  if v_why is not null then perform _fail(v_why, 'closed'); end if;
  if v_action not in ('patch', 'torpedo', 'discard') then perform _fail('Choose patch or torpedo.', 'invalid'); end if;
  if v_action = 'torpedo' then
    if v_target is null or not exists (select 1 from teams where id = v_target) then perform _fail('Pick a team to torpedo.', 'invalid'); end if;
    if v_target = v_student.team_id then perform _fail('You can''t torpedo your own submarine.', 'invalid'); end if;
    perform _m_lock(r.id, array[v_student.team_id, v_target]);
  else
    v_target := null;
    perform _m_lock(r.id, array[v_student.team_id]);
  end if;
  select * into v_answer from mystery_answers
   where round_id = r.id and team_id = v_student.team_id and correct and spent_as is null
   order by at limit 1 for update;
  if not found then perform _fail('Nothing to use yet. Answer a question correctly first.', 'no_hit'); end if;

  if v_action = 'patch' then
    v_value := _m_cfg(r, 'patch', 20) * _m_factor(r.id, 'patch', v_student.team_id, v_now);
    v_res := _m_apply(r.id, v_student.team_id, v_now, 'add', v_value);
    if (v_res->>'was_sunk')::boolean then
      perform _fail('You''re at Rock Bottom, so patches can''t lift you. You can still fire torpedoes.', 'sunk');
    end if;
    insert into mystery_log (round_id, at, kind, team_id, delta, score_after, public, by_student, problem_id)
    values (r.id, v_now, 'patch', v_student.team_id, (v_res->>'after')::double precision - (v_res->>'before')::double precision,
            (v_res->>'after')::double precision, true, v_student.id, v_answer.problem_id);
  elsif v_action = 'torpedo' then
    v_value := _m_cfg(r, 'torpedo', 10) * _m_factor(r.id, 'torpedo', v_student.team_id, v_now) * _m_factor(r.id, 'armor', v_target, v_now);
    v_res := _m_apply(r.id, v_target, v_now, 'add', -v_value);
    if (v_res->>'was_sunk')::boolean and not coalesce((r.config->>'allow_hit_sunk')::boolean, false) then
      perform _fail('That team is already at Rock Bottom. Pick another target.', 'target_sunk');
    end if;
    insert into mystery_log (round_id, at, kind, team_id, target_id, delta, score_after, public, by_student, problem_id)
    values (r.id, v_now, 'torpedo', v_student.team_id, v_target,
            (v_res->>'after')::double precision - (v_res->>'before')::double precision,
            (v_res->>'after')::double precision, true, v_student.id, v_answer.problem_id);
  else
    -- Only when there is nothing useful left to do with it.
    v_mine := _m_peek(r.id, v_student.team_id, v_now);
    select count(*) into v_floating from jsonb_array_elements(_m_board(r.id, v_now, false)) e
     where not (e->>'sunk')::boolean and e->>'id' <> v_student.team_id;
    if not (v_mine->>'sunk')::boolean or v_floating > 0 then
      perform _fail('Use it: patch your hull or torpedo a team.', 'invalid');
    end if;
  end if;

  update mystery_answers set spent_as = v_action, spent_at = v_now, target_id = v_target
   where round_id = r.id and team_id = v_student.team_id and problem_id = v_answer.problem_id;
  return jsonb_build_object('ok', true, 'action', v_action, 'target', v_target, 'value', v_value, 'result', v_res, 'now', v_now);
end $$;

create or replace function public_board(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := sfmo_now();
  r rounds;
  v_staff boolean := auth.uid() is not null and exists (select 1 from staff where user_id = auth.uid());
begin
  if not v_staff and not coalesce((_cfg()->>'public_boards')::boolean, false) then
    perform _fail('This board isn''t public.', 'not_public');
  end if;
  select * into r from rounds where id = p->>'round' and kind in ('guts', 'mystery') and (visible or v_staff);
  if not found then perform _fail('There is no board for that round.', 'not_found'); end if;
  return jsonb_build_object(
    'now', v_now,
    'settings', jsonb_build_object('event_name', _cfg()->'event_name', 'event_subtitle', _cfg()->'event_subtitle'),
    'round', _round_pub(r, v_now),
    'board', case when r.kind = 'guts' then _guts_board(r.id) else _m_board(r.id, v_now, true) end,
    'feed', case when r.kind = 'mystery' then _m_feed(r.id, nullif(p->>'since', '')::bigint, null, false) end,
    'mods', case when r.kind = 'mystery' then _m_mods(r.id, v_now, false) end);
end $$;

-- ---------------------------------------------------------------- staff API: accounts

-- Run once in the Supabase SQL editor after creating your account in the app:
--   select sfmo_make_admin('you@example.com');
create or replace function sfmo_make_admin(p_email text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email)) order by created_at limit 1;
  if v_id is null then return 'No account with that email yet. Create it on the staff sign-in page first.'; end if;
  insert into staff (user_id, email, name, role) values (v_id, lower(btrim(p_email)), '', 'admin')
  on conflict (user_id) do update set role = 'admin';
  perform _log_audit('sql editor', 'make_admin', jsonb_build_object('email', p_email));
  return 'Done: ' || p_email || ' is an admin.';
end $$;

create or replace function st_me(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_staff staff; v_email text;
begin
  if auth.uid() is null then return jsonb_build_object('user', null); end if;
  select email into v_email from auth.users where id = auth.uid();
  select * into v_staff from staff where user_id = auth.uid();
  return jsonb_build_object(
    'now', sfmo_now(),
    'user', jsonb_build_object('id', auth.uid(), 'email', v_email),
    'staff', case when v_staff.user_id is null then null
                  else jsonb_build_object('user_id', v_staff.user_id, 'email', v_staff.email, 'name', v_staff.name, 'role', v_staff.role) end,
    'has_admin', exists (select 1 from staff where role = 'admin'));
end $$;

create or replace function st_redeem(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9]', '', 'g'));
  v_inv staff_invites;
  v_email text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'Sign in first.', 'code', 'signed_out'); end if;
  if exists (select 1 from staff where user_id = auth.uid()) then return jsonb_build_object('ok', true, 'already', true); end if;
  if (select count(*) from staff_failures where user_id = auth.uid() and at > sfmo_now() - interval '10 minutes') >= 6 then
    return jsonb_build_object('error', 'Too many tries. Wait ten minutes.', 'code', 'rate_limited');
  end if;
  select * into v_inv from staff_invites
   where regexp_replace(code, '[^A-Z0-9]', '', 'g') = v_code and used_at is null and expires_at > sfmo_now()
   for update;
  if not found then
    insert into staff_failures (user_id, at) values (auth.uid(), sfmo_now());
    return jsonb_build_object('error', 'That code isn''t valid. Ask an admin for a new one.', 'code', 'bad_code');
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into staff (user_id, email, name, role)
  values (auth.uid(), coalesce(v_email, ''), left(coalesce(nullif(btrim(p->>'name'), ''), v_inv.name), 80), v_inv.role);
  update staff_invites set used_by = auth.uid(), used_at = sfmo_now() where code = v_inv.code;
  perform _log_audit(coalesce(v_email, auth.uid()::text), 'joined_staff', jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('ok', true, 'role', v_inv.role);
end $$;

create or replace function st_staff(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('admin');
begin
  return jsonb_build_object(
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'name', name, 'role', role, 'created_at', created_at) order by role, email), '[]'::jsonb) from staff),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'role', role, 'name', name, 'created_at', created_at, 'expires_at', expires_at) order by created_at desc), '[]'::jsonb)
                  from staff_invites where used_at is null and expires_at > sfmo_now()));
end $$;

create or replace function st_staff_change(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('admin');
  v_action text := p->>'action';
  v_code text;
  v_user uuid := _as_uuid(p->>'user_id');
begin
  if v_action = 'invite' then
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    insert into staff_invites (code, role, name, created_by, created_at, expires_at)
    values (v_code, case when p->>'role' = 'admin' then 'admin' else 'proctor' end, left(coalesce(p->>'name', ''), 80),
            _staff_label(v_me), sfmo_now(), sfmo_now() + make_interval(days => greatest(1, least(60, coalesce(nullif(p->>'days', '')::int, 14)))));
    perform _log_audit(_staff_label(v_me), 'invite_staff', jsonb_build_object('role', p->>'role', 'name', p->>'name'));
    return jsonb_build_object('code', v_code);
  elsif v_action = 'revoke_invite' then
    delete from staff_invites where code = p->>'code';
  elsif v_action = 'set_role' then
    if p->>'role' not in ('admin', 'proctor') then perform _fail('Unknown role.', 'invalid'); end if;
    if p->>'role' = 'proctor' and (select count(*) from staff where role = 'admin' and user_id <> v_user) = 0 then
      perform _fail('There has to be at least one admin.', 'last_admin');
    end if;
    update staff set role = p->>'role', name = coalesce(nullif(left(p->>'name', 80), ''), name) where user_id = v_user;
  elsif v_action = 'rename' then
    update staff set name = left(coalesce(p->>'name', ''), 80) where user_id = v_user;
  elsif v_action = 'remove' then
    if (select count(*) from staff where role = 'admin' and user_id <> v_user) = 0 then
      perform _fail('There has to be at least one admin.', 'last_admin');
    end if;
    delete from staff where user_id = v_user;
  else
    perform _fail('Unknown action.', 'invalid');
  end if;
  perform _log_audit(_staff_label(v_me), 'staff_' || v_action, p - 'token');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- staff API: overview and settings

create or replace function st_state(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_now timestamptz := sfmo_now();
begin
  return jsonb_build_object(
    'now', v_now,
    'me', jsonb_build_object('user_id', v_me.user_id, 'email', v_me.email, 'name', v_me.name, 'role', v_me.role),
    'settings', _cfg(),
    'rounds', (select coalesce(jsonb_agg(_round_staff(r, v_now) order by r.sort, r.id), '[]'::jsonb) from rounds r),
    'counts', jsonb_build_object(
      'teams', (select count(*) from teams),
      'students', (select count(*) from students),
      'online', (select count(distinct student_id) from sessions where last_seen > v_now - interval '45 seconds' and expires_at > v_now),
      'signed_in', (select count(distinct student_id) from sessions where expires_at > v_now),
      'flags', (select count(*) from integrity where at > v_now - interval '15 minutes')),
    'announcements', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'text', a.text, 'tone', a.tone, 'round_id', a.round_id, 'by', a.by_staff) order by a.id desc), '[]'::jsonb)
                        from (select * from announcements order by id desc limit 30) a));
end $$;

create or replace function st_settings_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('admin'); v_data jsonb := coalesce(p->'data', '{}'::jsonb);
begin
  if jsonb_typeof(v_data) <> 'object' or length(v_data::text) > 20000 then perform _fail('Settings are too large.', 'invalid'); end if;
  update settings set data = data || v_data, updated_at = sfmo_now() where id = 1;
  perform _log_audit(_staff_label(v_me), 'settings', v_data);
  return jsonb_build_object('settings', _cfg());
end $$;

create or replace function st_announce(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_id bigint;
begin
  if p->>'action' = 'delete' then
    delete from announcements where id = nullif(p->>'id', '')::bigint;
    perform _log_audit(_staff_label(v_me), 'announcement_delete', jsonb_build_object('id', p->>'id'));
    return jsonb_build_object('ok', true);
  end if;
  if coalesce(btrim(p->>'text'), '') = '' then perform _fail('Write something first.', 'invalid'); end if;
  insert into announcements (at, text, tone, round_id, by_staff)
  values (sfmo_now(), left(btrim(p->>'text'), 1000), case when p->>'tone' = 'urgent' then 'urgent' else 'info' end,
          (select id from rounds where id = nullif(p->>'round', '')), _staff_label(v_me))
  returning id into v_id;
  perform _log_audit(_staff_label(v_me), 'announce', jsonb_build_object('id', v_id, 'text', left(p->>'text', 200)));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------------------------------------------------------------- staff API: rounds

create or replace function st_round_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('admin');
  v_id text := nullif(p->>'id', '');
  r rounds;
  v_new boolean := false;
begin
  if v_id is null then
    v_new := true;
    v_id := left(trim(both '-' from regexp_replace(lower(coalesce(p->>'title', 'round')), '[^a-z0-9]+', '-', 'g')), 30);
    if v_id = '' then v_id := 'round'; end if;
    if exists (select 1 from rounds where id = v_id) then v_id := v_id || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4); end if;
    if coalesce(p->>'kind', '') not in ('individual', 'guts', 'mystery') then perform _fail('Choose a round type.', 'invalid'); end if;
    insert into rounds (id, kind, title, sort, config)
    values (v_id, p->>'kind', coalesce(nullif(btrim(p->>'title'), ''), 'New round'),
            coalesce((select max(sort) + 1 from rounds), 0),
            case p->>'kind'
              when 'mystery' then jsonb_build_object('start', 200, 'sink_rate', 0.1, 'patch', 20, 'torpedo', 10, 'salvage', 10, 'show_board', true, 'anonymous_attacks', false, 'allow_hit_sunk', false)
              when 'guts' then jsonb_build_object('show_board', true, 'reveal_set_scores', true)
              else '{}'::jsonb end);
  end if;
  select * into r from rounds where id = v_id for update;
  if not found then perform _fail('That round doesn''t exist.', 'not_found'); end if;
  -- A running dive whose sinking speed or start changes: pin every team's depth
  -- at this moment first, so the new numbers only apply from now on.
  if r.kind = 'mystery' and r.opens_at is not null and jsonb_typeof(p->'config') = 'object'
     and ((p->'config' ? 'sink_rate' and (p->'config'->>'sink_rate') is distinct from (r.config->>'sink_rate'))
       or (p->'config' ? 'start' and (p->'config'->>'start') is distinct from (r.config->>'start'))) then
    perform _m_lock(r.id, array(select id from teams order by id));
    perform _m_apply(r.id, t.id, sfmo_now(), 'add', 0) from teams t order by t.id;
  end if;
  update rounds set
    title = coalesce(nullif(left(btrim(p->>'title'), 80), ''), title),
    blurb = coalesce(left(p->>'blurb', 300), blurb),
    rules = coalesce(left(p->>'rules', 5000), rules),
    sort = coalesce(nullif(p->>'sort', '')::int, sort),
    minutes = coalesce(nullif(p->>'minutes', '')::int, minutes),
    grace_seconds = coalesce(nullif(p->>'grace_seconds', '')::int, grace_seconds),
    scheduled_at = case when p ? 'scheduled_at' then nullif(p->>'scheduled_at', '')::timestamptz else scheduled_at end,
    visible = coalesce((p->>'visible')::boolean, visible),
    show_results = coalesce((p->>'show_results')::boolean, show_results),
    config = config || coalesce(case when jsonb_typeof(p->'config') = 'object' then p->'config' end, '{}'::jsonb)
  where id = v_id;
  perform _log_audit(_staff_label(v_me), case when v_new then 'round_create' else 'round_edit' end, jsonb_build_object('id', v_id) || (p - 'rules'));
  select * into r from rounds where id = v_id;
  return _round_staff(r, sfmo_now());
end $$;

create or replace function st_round_delete(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('admin');
begin
  delete from rounds where id = p->>'id';
  perform _log_audit(_staff_label(v_me), 'round_delete', jsonb_build_object('id', p->>'id'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function _round_wipe(p_round text) returns void language plpgsql as $$
begin
  delete from responses where round_id = p_round;
  delete from guts_sets where round_id = p_round;
  delete from mystery_subs where round_id = p_round;
  delete from mystery_mods where round_id = p_round;
  delete from mystery_answers where round_id = p_round;
  delete from mystery_log where round_id = p_round;
  delete from integrity where round_id = p_round;
  delete from announcements where round_id = p_round;
  update rounds set opens_at = null, closes_at = null, paused_at = null where id = p_round;
end $$;

create or replace function st_round_control(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('proctor');
  v_now timestamptz := sfmo_now();
  v_action text := p->>'action';
  v_minutes int := nullif(p->>'minutes', '')::int;
  v_at timestamptz;
  r rounds;
  v_state text;
begin
  select * into r from rounds where id = p->>'id' for update;
  if not found then perform _fail('That round doesn''t exist.', 'not_found'); end if;
  v_state := _state(r, v_now);

  if v_action = 'start' then
    if v_state in ('open', 'paused') then perform _fail('It''s already running.', 'invalid'); end if;
    if v_state = 'closed' then perform _fail('This round already ran. Reset it first, or reopen it.', 'invalid'); end if;
    if (select count(*) from problems where round_id = r.id) = 0 then perform _fail('Add problems to this round before starting it.', 'no_problems'); end if;
    update rounds set opens_at = v_now, closes_at = v_now + make_interval(mins => r.minutes), paused_at = null where id = r.id;
  elsif v_action = 'schedule' then
    v_at := nullif(p->>'at', '')::timestamptz;
    if v_at is null or v_at <= v_now then perform _fail('Pick a time in the future.', 'invalid'); end if;
    if v_state <> 'waiting' then perform _fail('Only a round that hasn''t started can be scheduled.', 'invalid'); end if;
    update rounds set opens_at = v_at, closes_at = v_at + make_interval(mins => r.minutes), scheduled_at = v_at where id = r.id;
  elsif v_action = 'unschedule' then
    if v_state <> 'waiting' then perform _fail('It has already started.', 'invalid'); end if;
    update rounds set opens_at = null, closes_at = null where id = r.id;
  elsif v_action = 'pause' then
    if v_state <> 'open' then perform _fail('Only a running round can be paused.', 'invalid'); end if;
    update rounds set paused_at = v_now where id = r.id;
    if r.kind = 'mystery' then
      insert into mystery_mods (round_id, kind, factor, starts_at, label, hidden) values (r.id, 'sink', 0, v_now, '__pause', true);
      insert into mystery_log (round_id, at, kind, label, public, by_staff) values (r.id, v_now, 'pause', 'Paused', true, _staff_label(v_me));
    end if;
  elsif v_action = 'resume' then
    if r.paused_at is null then perform _fail('It isn''t paused.', 'invalid'); end if;
    update rounds set closes_at = closes_at + (v_now - paused_at), paused_at = null where id = r.id;
    if r.kind = 'mystery' then
      update mystery_mods set ends_at = v_now where round_id = r.id and label = '__pause' and ends_at is null;
      insert into mystery_log (round_id, at, kind, label, public, by_staff) values (r.id, v_now, 'resume', 'Resumed', true, _staff_label(v_me));
    end if;
  elsif v_action = 'extend' then
    if r.opens_at is null then perform _fail('Start the round first.', 'invalid'); end if;
    if v_minutes is null or v_minutes = 0 then perform _fail('How many minutes?', 'invalid'); end if;
    if v_state = 'closed' then perform _fail('It''s closed. Use reopen.', 'invalid'); end if;
    update rounds set closes_at = greatest(v_now, closes_at + make_interval(mins => v_minutes)) where id = r.id;
  elsif v_action = 'close' then
    if v_state not in ('open', 'paused') then perform _fail('It isn''t running.', 'invalid'); end if;
    if r.paused_at is not null then
      update rounds set paused_at = null where id = r.id;
      update mystery_mods set ends_at = v_now where round_id = r.id and label = '__pause' and ends_at is null;
    end if;
    update rounds set closes_at = v_now where id = r.id;
    if r.kind = 'mystery' then
      insert into mystery_log (round_id, at, kind, label, public, by_staff) values (r.id, v_now, 'close', 'Dive over', true, _staff_label(v_me));
    end if;
  elsif v_action = 'reopen' then
    if v_state <> 'closed' then perform _fail('It isn''t closed.', 'invalid'); end if;
    if v_minutes is null or v_minutes <= 0 then perform _fail('How many minutes?', 'invalid'); end if;
    if r.kind = 'mystery' then
      -- Nobody sank while the round was shut.
      insert into mystery_mods (round_id, kind, factor, starts_at, ends_at, label, hidden) values (r.id, 'sink', 0, r.closes_at, v_now, '__gap', true);
    end if;
    update rounds set closes_at = v_now + make_interval(mins => v_minutes) where id = r.id;
  elsif v_action = 'reset' then
    if v_me.role <> 'admin' then perform _fail('Only admins can reset a round.', 'admin_only'); end if;
    perform _round_wipe(r.id);
  else
    perform _fail('Unknown action.', 'invalid');
  end if;
  perform _log_audit(_staff_label(v_me), 'round_' || v_action, jsonb_build_object('id', r.id, 'minutes', v_minutes, 'at', p->>'at'));
  select * into r from rounds where id = r.id;
  return _round_staff(r, v_now);
end $$;

-- ---------------------------------------------------------------- staff API: problems

create or replace function st_problems(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor');
begin
  return jsonb_build_object('problems', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'set_no', set_no, 'points', points, 'body', body, 'answer', answer, 'keys', keys) order by number), '[]'::jsonb)
      from problems where round_id = p->>'round'));
end $$;

create or replace function st_problems_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('admin');
  v_round text := p->>'round';
  v_item jsonb;
  v_keep uuid[] := '{}';
  v_id uuid;
  v_keys text[];
  v_n int := 0;
begin
  if not exists (select 1 from rounds where id = v_round) then perform _fail('That round doesn''t exist.', 'not_found'); end if;
  if jsonb_typeof(p->'problems') <> 'array' then perform _fail('No problems sent.', 'invalid'); end if;
  if jsonb_array_length(p->'problems') > 200 then perform _fail('At most 200 problems per round.', 'invalid'); end if;
  -- Move numbers out of the way so problems can be renumbered in any order.
  update problems set number = -number - 100000 where round_id = v_round;
  for v_item in select * from jsonb_array_elements(p->'problems') loop
    v_n := v_n + 1;
    v_keys := array(select left(x, 200) from jsonb_array_elements_text(coalesce(v_item->'keys', '[]'::jsonb)) x where x <> '');
    v_id := _as_uuid(v_item->>'id');
    if v_id is not null and exists (select 1 from problems where id = v_id and round_id = v_round) then
      update problems set number = v_n, set_no = greatest(1, coalesce(nullif(v_item->>'set_no', '')::int, 1)),
        points = coalesce(nullif(v_item->>'points', '')::double precision, 1), body = left(coalesce(v_item->>'body', ''), 20000),
        answer = left(coalesce(v_item->>'answer', ''), 500), keys = v_keys
       where id = v_id;
    else
      insert into problems (round_id, number, set_no, points, body, answer, keys)
      values (v_round, v_n, greatest(1, coalesce(nullif(v_item->>'set_no', '')::int, 1)), coalesce(nullif(v_item->>'points', '')::double precision, 1),
              left(coalesce(v_item->>'body', ''), 20000), left(coalesce(v_item->>'answer', ''), 500), v_keys)
      returning id into v_id;
    end if;
    v_keep := v_keep || v_id;
  end loop;
  delete from problems where round_id = v_round and not (id = any(v_keep));
  perform _log_audit(_staff_label(v_me), 'problems_save', jsonb_build_object('round', v_round, 'count', v_n));
  return st_problems(jsonb_build_object('round', v_round));
end $$;

create or replace function st_ruling(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_problem uuid := _as_uuid(p->>'problem');
begin
  if not exists (select 1 from problems where id = v_problem) then perform _fail('Unknown problem.', 'not_found'); end if;
  if p->>'correct' is null then
    delete from rulings where problem_id = v_problem and norm = p->>'norm';
  else
    insert into rulings (problem_id, norm, correct, by_staff, at)
    values (v_problem, left(p->>'norm', 200), (p->>'correct')::boolean, _staff_label(v_me), sfmo_now())
    on conflict (problem_id, norm) do update set correct = excluded.correct, by_staff = excluded.by_staff, at = excluded.at;
  end if;
  perform _log_audit(_staff_label(v_me), 'ruling', p);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- staff API: roster

create or replace function st_roster(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_now timestamptz := sfmo_now();
begin
  return jsonb_build_object('now', v_now, 'teams', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'room_url', t.room_url, 'notes', t.notes,
      'students', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'name', s.name, 'email', s.email, 'extra_minutes', s.extra_minutes, 'disabled', s.disabled,
          'devices', (select count(*) from sessions se where se.student_id = s.id and se.expires_at > v_now and se.last_seen > v_now - interval '45 seconds'),
          'sessions', (select count(*) from sessions se where se.student_id = s.id and se.expires_at > v_now),
          'last_seen', (select max(last_seen) from sessions se where se.student_id = s.id),
          'flags', (select count(*) from integrity i where i.student_id = s.id)) order by s.id), '[]'::jsonb)
        from students s where s.team_id = t.id)) order by t.id), '[]'::jsonb)
    from teams t));
end $$;

create or replace function _norm_id(t text) returns text language sql immutable as $$
  select upper(regexp_replace(btrim(coalesce(t, '')), '\s+', '', 'g'))
$$;

create or replace function st_roster_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('admin');
  v_row jsonb;
  v_i int := 0;
  v_team text; v_student text; v_email text;
  v_teams_new int := 0; v_students_new int := 0; v_students_upd int := 0; v_removed int := 0;
  v_seen_teams text[] := '{}'; v_seen_students text[] := '{}';
begin
  if jsonb_typeof(p->'rows') <> 'array' then perform _fail('Nothing to import.', 'invalid'); end if;
  if jsonb_array_length(p->'rows') > 3000 then perform _fail('At most 3000 rows at a time.', 'invalid'); end if;
  for v_row in select * from jsonb_array_elements(p->'rows') loop
    v_i := v_i + 1;
    v_team := _norm_id(v_row->>'team_id');
    v_student := _norm_id(v_row->>'student_id');
    v_email := lower(btrim(coalesce(v_row->>'email', '')));
    if v_team !~ '^[A-Z0-9_-]{1,16}$' then perform _fail(format('Row %s: team number "%s" should be letters/digits, up to 16.', v_i, v_row->>'team_id'), 'invalid'); end if;
    if not exists (select 1 from teams where id = v_team) then
      insert into teams (id, name, room_url) values (v_team, coalesce(nullif(left(btrim(v_row->>'team_name'), 80), ''), 'Team ' || v_team), coalesce(left(v_row->>'room_url', 500), ''));
      v_teams_new := v_teams_new + 1;
    else
      update teams set name = coalesce(nullif(left(btrim(v_row->>'team_name'), 80), ''), name),
                       room_url = coalesce(nullif(left(v_row->>'room_url', 500), ''), room_url)
       where id = v_team;
    end if;
    v_seen_teams := v_seen_teams || v_team;
    if v_student <> '' then
      if v_student !~ '^[A-Z0-9_-]{1,16}$' then perform _fail(format('Row %s: student ID "%s" should be letters/digits, up to 16.', v_i, v_row->>'student_id'), 'invalid'); end if;
      if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform _fail(format('Row %s: "%s" doesn''t look like an email.', v_i, v_row->>'email'), 'invalid'); end if;
      if coalesce(btrim(v_row->>'name'), '') = '' then perform _fail(format('Row %s: student %s needs a name.', v_i, v_student), 'invalid'); end if;
      if exists (select 1 from students where id = v_student) then v_students_upd := v_students_upd + 1; else v_students_new := v_students_new + 1; end if;
      insert into students (id, team_id, name, email) values (v_student, v_team, left(btrim(v_row->>'name'), 100), v_email)
      on conflict (id) do update set team_id = excluded.team_id, name = excluded.name, email = excluded.email;
      v_seen_students := v_seen_students || v_student;
    end if;
  end loop;
  if coalesce((p->>'replace')::boolean, false) then
    delete from students where not (id = any(v_seen_students));
    get diagnostics v_removed = row_count;
    delete from teams where not (id = any(v_seen_teams));
  end if;
  perform _log_audit(_staff_label(v_me), 'roster_import', jsonb_build_object('rows', v_i, 'replace', coalesce((p->>'replace')::boolean, false)));
  return jsonb_build_object('rows', v_i, 'teams_new', v_teams_new, 'students_new', v_students_new, 'students_updated', v_students_upd, 'removed', v_removed);
end $$;

create or replace function st_roster_change(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('proctor');
  v_action text := p->>'action';
  v_team text := _norm_id(p->>'team_id');
  v_student text := _norm_id(p->>'student_id');
  v_n int := 0;
begin
  if v_action not in ('sign_out', 'sign_out_all', 'disable', 'enable') and v_me.role <> 'admin' then
    perform _fail('Only admins can edit the roster.', 'admin_only');
  end if;
  if v_action = 'save_team' then
    if v_team !~ '^[A-Z0-9_-]{1,16}$' then perform _fail('Team numbers are letters and digits, up to 16.', 'invalid'); end if;
    insert into teams (id, name, room_url, notes) values (v_team, coalesce(nullif(left(btrim(p->>'name'), 80), ''), 'Team ' || v_team), coalesce(left(p->>'room_url', 500), ''), coalesce(left(p->>'notes', 1000), ''))
    on conflict (id) do update set name = excluded.name, room_url = excluded.room_url, notes = excluded.notes;
  elsif v_action = 'delete_team' then
    delete from teams where id = v_team;
  elsif v_action = 'save_student' then
    if v_student !~ '^[A-Z0-9_-]{1,16}$' then perform _fail('Student IDs are letters and digits, up to 16.', 'invalid'); end if;
    if not exists (select 1 from teams where id = v_team) then perform _fail('Pick a team that exists.', 'invalid'); end if;
    if coalesce(p->>'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform _fail('That doesn''t look like an email.', 'invalid'); end if;
    if coalesce(btrim(p->>'name'), '') = '' then perform _fail('Add a name.', 'invalid'); end if;
    insert into students (id, team_id, name, email, extra_minutes)
    values (v_student, v_team, left(btrim(p->>'name'), 100), lower(btrim(p->>'email')), greatest(0, least(600, coalesce(nullif(p->>'extra_minutes', '')::int, 0))))
    on conflict (id) do update set team_id = excluded.team_id, name = excluded.name, email = excluded.email, extra_minutes = excluded.extra_minutes;
  elsif v_action = 'delete_student' then
    delete from students where id = v_student;
  elsif v_action = 'sign_out' then
    delete from sessions where student_id = v_student or (v_student = '' and student_id in (select id from students where team_id = v_team));
    get diagnostics v_n = row_count;
  elsif v_action = 'sign_out_all' then
    delete from sessions;
    get diagnostics v_n = row_count;
  elsif v_action in ('disable', 'enable') then
    update students set disabled = (v_action = 'disable') where id = v_student;
    if v_action = 'disable' then delete from sessions where student_id = v_student; end if;
  else
    perform _fail('Unknown action.', 'invalid');
  end if;
  perform _log_audit(_staff_label(v_me), 'roster_' || v_action, p);
  return jsonb_build_object('ok', true, 'count', v_n);
end $$;

-- ---------------------------------------------------------------- staff API: results and integrity

create or replace function st_results(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('proctor');
  v_now timestamptz := sfmo_now();
  r rounds;
  v_problems jsonb;
  v_rows jsonb;
  v_review jsonb;
begin
  select * into r from rounds where id = p->>'round';
  if not found then perform _fail('That round doesn''t exist.', 'not_found'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'number', number, 'set_no', set_no, 'points', points, 'answer', answer, 'keys', keys) order by number), '[]'::jsonb)
    into v_problems from problems where round_id = r.id;

  if r.kind = 'mystery' then
    select coalesce(jsonb_agg(b || jsonb_build_object(
        'correct', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and a.correct),
        'wrong', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and not a.correct),
        'patches', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and a.spent_as = 'patch'),
        'torpedoes', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and a.spent_as = 'torpedo'),
        'hits_taken', (select count(*) from mystery_answers a where a.round_id = r.id and a.target_id = b->>'id'),
        'answers', (select coalesce(jsonb_object_agg(a.problem_id, jsonb_build_object('raw', a.raw, 'ok', a.correct, 'spent_as', a.spent_as, 'target_id', a.target_id)), '{}'::jsonb)
                      from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id'))
        order by (b->>'score')::double precision desc, b->>'id'), '[]'::jsonb)
      into v_rows
      from jsonb_array_elements(_m_board(r.id, coalesce(least(v_now, r.closes_at), v_now), true)) b;
    v_review := '[]'::jsonb;
  else
    with entrants as (
      select s.id, s.name, s.team_id, t.name as team_name from students s join teams t on t.id = s.team_id where r.kind = 'individual'
      union all
      select t.id, t.name, t.id, t.name from teams t where r.kind = 'guts'
    ),
    graded as (
      select rs.entrant_id, pr.id as problem_id, pr.points, rs.raw, rs.norm, _ok(pr.id, pr.keys, rs.norm) as ok,
             (r.kind <> 'guts' or exists (select 1 from guts_sets g where g.round_id = r.id and g.team_id = rs.entrant_id and g.set_no = pr.set_no)) as counts
        from responses rs join problems pr on pr.id = rs.problem_id
       where rs.round_id = r.id
    )
    select coalesce(jsonb_agg(x order by (x->>'score')::double precision desc, x->>'id'), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('id', e.id, 'name', e.name, 'team_id', e.team_id, 'team_name', e.team_name,
        'score', coalesce((select sum(g.points) from graded g where g.entrant_id = e.id and g.ok and g.counts), 0),
        'correct', (select count(*) from graded g where g.entrant_id = e.id and g.ok and g.counts),
        'answered', (select count(*) from graded g where g.entrant_id = e.id),
        'sets', case when r.kind = 'guts' then (select count(*) from guts_sets gs where gs.round_id = r.id and gs.team_id = e.id) end,
        'flags', case when r.kind = 'individual' then (select count(*) from integrity i where i.round_id = r.id and i.student_id = e.id) end,
        'answers', (select coalesce(jsonb_object_agg(g.problem_id, jsonb_build_object('raw', g.raw, 'ok', g.ok, 'counts', g.counts)), '{}'::jsonb) from graded g where g.entrant_id = e.id)) x
      from entrants e) q;

    -- Answers that aren't in the key and haven't been ruled on, grouped.
    select coalesce(jsonb_agg(jsonb_build_object('problem_id', q.problem_id, 'number', q.number, 'norm', q.norm, 'raw', q.raw, 'count', q.n, 'ruling', q.ruling) order by q.number, q.n desc), '[]'::jsonb)
      into v_review from (
        select pr.id as problem_id, pr.number, rs.norm, min(rs.raw) as raw, count(*) as n,
               (select correct from rulings ru where ru.problem_id = pr.id and ru.norm = rs.norm) as ruling
          from responses rs join problems pr on pr.id = rs.problem_id
         where rs.round_id = r.id and rs.norm <> '' and not (rs.norm = any(pr.keys))
         group by pr.id, pr.number, rs.norm) q;
  end if;
  return jsonb_build_object('now', v_now, 'round', _round_staff(r, v_now), 'problems', v_problems, 'rows', v_rows, 'review', v_review);
end $$;

create or replace function st_integrity(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor');
begin
  return jsonb_build_object('events', (
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'at', i.at, 'round_id', i.round_id, 'student_id', i.student_id,
      'name', s.name, 'team_id', s.team_id, 'kind', i.kind, 'ms', i.ms) order by i.id desc), '[]'::jsonb)
    from (select * from integrity where (nullif(p->>'round', '') is null or round_id = p->>'round') order by id desc limit 500) i
    join students s on s.id = i.student_id));
end $$;

create or replace function st_audit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('admin');
begin
  return jsonb_build_object('entries', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'at', at, 'actor', actor, 'action', action, 'detail', detail) order by id desc), '[]'::jsonb)
    from (select * from audit order by id desc limit 300) a));
end $$;

-- ---------------------------------------------------------------- staff API: Mystery Dive console

create or replace function st_mystery(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_now timestamptz := sfmo_now(); r rounds;
begin
  select * into r from rounds where id = coalesce(p->>'round', 'mystery') and kind = 'mystery';
  if not found then perform _fail('There is no Mystery Dive round.', 'not_found'); end if;
  return jsonb_build_object(
    'now', v_now,
    'round', _round_staff(r, v_now),
    'board', (select coalesce(jsonb_agg(b || jsonb_build_object(
                'pending', exists (select 1 from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and a.correct and a.spent_as is null),
                'answered', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id'),
                'correct', (select count(*) from mystery_answers a where a.round_id = r.id and a.team_id = b->>'id' and a.correct))), '[]'::jsonb)
              from jsonb_array_elements(_m_board(r.id, v_now, true)) b),
    'feed', _m_feed(r.id, nullif(p->>'since', '')::bigint, null, true),
    'mods', _m_mods(r.id, v_now, true),
    'problem_count', (select count(*) from problems where round_id = r.id));
end $$;

create or replace function st_mystery_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('proctor');
  v_now timestamptz := sfmo_now();
  r rounds;
  v_type text := p->>'type';
  v_targets text[];
  v_value double precision := nullif(p->>'value', '')::double precision;
  v_label text := left(coalesce(nullif(btrim(p->>'label'), ''), 'Event'), 60);
  v_message text := left(coalesce(p->>'message', ''), 280);
  v_public boolean := coalesce((p->>'public')::boolean, true);
  v_all boolean := false;
  v_affected jsonb := '[]'::jsonb;
  v_team text;
  v_b jsonb;
  v_seconds int := nullif(p->>'seconds', '')::int;
  v_kind text := coalesce(p->>'mod_kind', 'sink');
  v_factor double precision := nullif(p->>'factor', '')::double precision;
  v_log bigint;
begin
  select * into r from rounds where id = coalesce(p->>'round', 'mystery') and kind = 'mystery';
  if not found then perform _fail('There is no Mystery Dive round.', 'not_found'); end if;
  if r.opens_at is null or v_now < r.opens_at then perform _fail('Start the dive first.', 'invalid'); end if;
  if v_now > r.closes_at then perform _fail('The dive is over. Reopen it to run events.', 'invalid'); end if;

  if jsonb_typeof(p->'targets') = 'array' then
    select array_agg(distinct _norm_id(x)) into v_targets from jsonb_array_elements_text(p->'targets') x;
  end if;
  if v_targets is null or 'ALL' = any(v_targets) then
    v_all := true;
    select coalesce(array_agg(id order by id), '{}') into v_targets from teams;
  else
    select coalesce(array_agg(t order by t), '{}') into v_targets from unnest(v_targets) t where exists (select 1 from teams where id = t);
  end if;
  if cardinality(v_targets) = 0 and v_type <> 'note' then perform _fail('Pick at least one team.', 'invalid'); end if;

  if v_type in ('add', 'set') then
    if v_value is null then perform _fail('Enter a value.', 'invalid'); end if;
    perform _m_lock(r.id, v_targets);
    foreach v_team in array v_targets loop
      v_affected := v_affected || _m_apply(r.id, v_team, v_now, v_type, v_value);
    end loop;
  elsif v_type = 'salvage' then
    v_value := coalesce(v_value, _m_cfg(r, 'salvage', 10));
    perform _m_lock(r.id, v_targets);
    foreach v_team in array v_targets loop
      v_b := _m_peek(r.id, v_team, v_now);
      if coalesce((v_b->>'sunk')::boolean, false) then
        v_affected := v_affected || _m_apply(r.id, v_team, v_now, 'revive', v_value);
      end if;
    end loop;
    select coalesce(array_agg(e->>'team'), '{}') into v_targets from jsonb_array_elements(v_affected) e;
    v_all := false;
  elsif v_type = 'mod' then
    if v_kind not in ('sink', 'patch', 'torpedo', 'armor') then perform _fail('Unknown modifier.', 'invalid'); end if;
    if v_factor is null then perform _fail('Enter a multiplier.', 'invalid'); end if;
    if v_seconds is not null and (v_seconds < 1 or v_seconds > 7200) then perform _fail('Duration must be 1 to 7200 seconds.', 'invalid'); end if;
    if v_all then
      insert into mystery_mods (round_id, kind, factor, team_id, starts_at, ends_at, label)
      values (r.id, v_kind, v_factor, null, v_now, v_now + make_interval(secs => v_seconds), v_label);
    else
      insert into mystery_mods (round_id, kind, factor, team_id, starts_at, ends_at, label)
      select r.id, v_kind, v_factor, t, v_now, v_now + make_interval(secs => v_seconds), v_label from unnest(v_targets) t;
    end if;
  elsif v_type <> 'note' then
    perform _fail('Unknown event type.', 'invalid');
  end if;

  insert into mystery_log (round_id, at, kind, targets, delta, label, message, public, by_staff, meta)
  values (r.id, v_now, 'event', case when v_all then array['ALL'] else v_targets end,
          case when v_type = 'add' then v_value end, v_label, v_message, v_public, _staff_label(v_me),
          jsonb_build_object('type', v_type, 'value', v_value, 'mod_kind', case when v_type = 'mod' then v_kind end,
                             'factor', v_factor, 'seconds', v_seconds, 'icon', left(coalesce(p->>'icon', ''), 24), 'affected', v_affected))
  returning id into v_log;
  perform _log_audit(_staff_label(v_me), 'mystery_event', p);
  return jsonb_build_object('ok', true, 'log_id', v_log, 'affected', v_affected, 'targets', v_targets);
end $$;

create or replace function st_mystery_mod_end(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me staff := _require_staff('proctor'); v_now timestamptz := sfmo_now(); v_mod mystery_mods;
begin
  update mystery_mods set ends_at = v_now
   where id = nullif(p->>'id', '')::bigint and starts_at <= v_now and (ends_at is null or ends_at > v_now) and not hidden
   returning * into v_mod;
  if v_mod.id is null then perform _fail('That effect already ended.', 'invalid'); end if;
  insert into mystery_log (round_id, at, kind, label, public, by_staff, meta)
  values (v_mod.round_id, v_now, 'mod_end', v_mod.label, true, _staff_label(v_me), jsonb_build_object('mod_id', v_mod.id));
  perform _log_audit(_staff_label(v_me), 'mystery_mod_end', p);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- staff API: resets

create or replace function st_reset(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_me staff := _require_staff('admin');
  v_scope text := p->>'scope';
  v_round text;
begin
  if coalesce(p->>'confirm', '') <> 'RESET' then perform _fail('Type RESET to confirm.', 'invalid'); end if;
  if v_scope = 'answers' then
    for v_round in select id from rounds loop perform _round_wipe(v_round); end loop;
    delete from integrity;
  elsif v_scope = 'sessions' then
    delete from sessions; delete from signin_failures;
  elsif v_scope = 'announcements' then
    delete from announcements;
  elsif v_scope = 'roster' then
    for v_round in select id from rounds loop perform _round_wipe(v_round); end loop;
    delete from sessions; delete from students; delete from teams;
  elsif v_scope = 'problems' then
    for v_round in select id from rounds loop perform _round_wipe(v_round); end loop;
    delete from rulings; delete from problems;
  elsif v_scope = 'everything' then
    delete from rounds; delete from sessions; delete from signin_failures; delete from students; delete from teams;
    delete from announcements; delete from integrity; delete from staff_invites;
    update settings set data = _default_settings(), updated_at = sfmo_now() where id = 1;
    perform _seed_rounds();
  else
    perform _fail('Unknown reset.', 'invalid');
  end if;
  perform _log_audit(_staff_label(v_me), 'reset_' || v_scope, null);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- grants

-- Supabase grants execute on new functions to anon and authenticated by
-- default. Take it all back, then hand out exactly the API.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', f.sig);
    end if;
  end loop;
end $$;

do $$
declare fn text;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  foreach fn in array array['s_info','s_sign_in','s_sign_out','s_home','s_round','s_save','s_guts_submit','s_flag',
                            's_mystery','s_mystery_answer','s_mystery_spend','public_board']
  loop
    execute format('grant execute on function %I(jsonb) to anon, authenticated', fn);
  end loop;
  foreach fn in array array['st_me','st_redeem','st_staff','st_staff_change','st_state','st_settings_save','st_announce',
                            'st_round_save','st_round_delete','st_round_control','st_problems','st_problems_save','st_ruling',
                            'st_roster','st_roster_import','st_roster_change','st_results','st_integrity','st_audit',
                            'st_mystery','st_mystery_event','st_mystery_mod_end','st_reset']
  loop
    execute format('grant execute on function %I(jsonb) to authenticated', fn);
  end loop;
end $$;

-- Helpers the API functions call run as the function owner (security definer),
-- so they need no grants. sfmo_now and _uuid etc. stay private too.
