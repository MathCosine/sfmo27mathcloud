import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, createStore, serverNow } from '../../lib/api';
import { go, storageGet, storageSet, usePoll, useTick } from '../../lib/hooks';
import { studentSignOut, token, useStudent } from '../../lib/session';
import { clock, DEFAULT_TZ, greeting, ms, timeOf, zoneName } from '../../lib/format';
import { Icon } from '../../ui/icons';
import { Brand, Button, ConnectionPill, ErrorNote, Initials, PageLoading } from '../../ui/kit';
import { RoundPage } from './RoundPage';

export type RoundInfo = {
  id: string; kind: 'individual' | 'guts' | 'mystery'; title: string; blurb: string; rules: string;
  minutes: number; scheduled_at: string | null; opens_at: string | null; closes_at: string | null;
  paused: boolean; state: 'waiting' | 'open' | 'paused' | 'closed'; show_results: boolean;
  config: Record<string, any>; problem_count: number; set_count: number;
  progress?: { answered: number; sets_done?: number };
};
export type Announcement = { id: number; at: string; text: string; tone: 'info' | 'urgent'; round_id: string | null };
export type Home = {
  now: string;
  me: { id: string; name: string; team_id: string; team_name: string };
  team: { id: string; name: string; room_url: string | null; members: { id: string; name: string; online: boolean }[] };
  settings: Record<string, any>;
  rounds: RoundInfo[];
  announcements: Announcement[];
};

/** The last home payload, so round pages know each round's kind and the settings. */
export const homeCache = createStore<Home | null>(null);

export function StudentApp({ route }: { route: string }) {
  const student = useStudent()!;
  const roundId = route.startsWith('round-') ? route.slice(6) : null;
  // Inside a round, the round's own updates carry what matters; check home rarely.
  const home = usePoll(async () => {
    const h = await call<Home>('s_home', { token: token() });
    homeCache.set(h);
    return h;
  }, roundId ? 60000 : 12000, [student.student.id]);

  return (
    <div className="shell">
      <TopBar />
      <main>
        {roundId ? (
          <RoundPage id={roundId} />
        ) : (
          <div className="wrap page">{home.data ? <HomePage home={home.data} /> : home.error ? <ErrorNote error={home.error} onRetry={home.refresh} /> : <PageLoading />}</div>
        )}
      </main>
    </div>
  );
}

function TopBar() {
  const s = useStudent()!;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <Brand />
        <div className="topbar-right">
          <ConnectionPill />
          <span className="chip chip-outline hide-sm" title={s.student.team_name}>Team {s.student.team_id}</span>
          <div style={{ position: 'relative' }} ref={ref}>
            <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 4, gap: 8 }} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
              <Initials name={s.student.name} />
              <span className="hide-sm">{s.student.name.split(' ')[0]}</span>
              <Icon name="down" size={14} />
            </button>
            {open && (
              <div className="menu" role="menu">
                <div className="menu-label">
                  <div style={{ fontWeight: 600 }}>{s.student.name}</div>
                  <div className="faint mono" style={{ fontSize: 12.5 }}>{s.student.id} · {s.student.team_name}</div>
                </div>
                <hr className="rule" style={{ margin: '6px 0' }} />
                <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); go(''); }}><Icon name="home" size={16} />Today</button>
                <button className="menu-item" role="menuitem" onClick={() => { setOpen(false); studentSignOut(); }}><Icon name="logout" size={16} />Sign out</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- home

const KIND_LABEL: Record<string, string> = { individual: 'Individual', guts: 'Team', mystery: 'Team · live' };

export function Announcements({ items, limit = 3 }: { items: Announcement[]; limit?: number }) {
  const [hidden, setHidden] = useState<number[]>(() => storageGet('sfmo27-dismissed', []));
  const shown = items.filter((a) => !hidden.includes(a.id)).slice(0, limit);
  if (!shown.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {shown.map((a) => (
        <div key={a.id} className={`banner ${a.tone === 'urgent' ? 'banner-urgent' : 'banner-live'}`} role="status">
          <Icon name="megaphone" />
          <div className="grow">
            <div>{a.text}</div>
            <div className="mono" style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{timeOf(a.at, DEFAULT_TZ)}</div>
          </div>
          <button className="btn btn-ghost btn-xs btn-icon" aria-label="Dismiss" onClick={() => { const next = [...hidden, a.id].slice(-50); setHidden(next); storageSet('sfmo27-dismissed', next); }}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

function HomePage({ home }: { home: Home }) {
  useTick(1000);
  const tz = home.settings.timezone || DEFAULT_TZ;
  const first = home.me.name.split(' ')[0];
  const rounds = home.rounds;
  const live = rounds.filter((r) => r.state === 'open' || r.state === 'paused');
  return (
    <>
      <section className="hello">
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>Team {home.team.id} · {home.team.name}</p>
          <h1>{greeting(tz)}, {first}.</h1>
          <p className="muted" style={{ marginTop: 10, maxWidth: 620 }}>{home.settings.welcome}</p>
        </div>
        {home.team.room_url && (
          <a className="btn btn-primary btn-lg" href={home.team.room_url} target="_blank" rel="noreferrer">
            <Icon name="video" />
            Join your Zoom room
            <Icon name="external" size={15} />
          </a>
        )}
      </section>

      <div className="home-grid">
        <div className="stack" style={{ gap: 22, minWidth: 0 }}>
          <Announcements items={home.announcements} />
          <div>
            <div className="spread" style={{ marginBottom: 10 }}>
              <h2>Today</h2>
              <span className="faint mono" style={{ fontSize: 12.5 }}>Times in {zoneName(tz)} · {live.length ? `${live.length} open now` : 'nothing open yet'}</span>
            </div>
            <div className="timetable stagger">
              {rounds.map((r, i) => <Slot key={r.id} r={r} tz={tz} i={i} />)}
            </div>
          </div>
        </div>
        <aside>
          <div className="side-card">
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="eyebrow">Your team</span>
              <span className="faint" style={{ fontSize: 12.5 }}>{home.team.members.filter((m) => m.online).length} online</span>
            </div>
            {home.team.members.map((m) => (
              <div key={m.id} className="member">
                <Initials name={m.name} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{m.name}{m.id === home.me.id && <span className="faint"> (you)</span>}</div>
                  <div className="faint mono" style={{ fontSize: 12 }}>{m.id}</div>
                </div>
                <span className={`presence ${m.online ? 'on' : ''}`} title={m.online ? 'Online now' : 'Not signed in right now'} />
              </div>
            ))}
          </div>
          <div className="side-card">
            <span className="eyebrow">Before each round</span>
            <ul className="checklist">
              <li>Camera on in Zoom, showing you and your desk.</li>
              <li>Only this tab open. Leaving it is recorded.</li>
              <li>Pencil and paper are fine. No calculators.</li>
            </ul>
          </div>
          <div className="side-card">
            <span className="eyebrow">Need help?</span>
            <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>{home.settings.help_text}</p>
            {home.settings.contact_email && <p className="mono" style={{ fontSize: 13, marginTop: 8 }}>{home.settings.contact_email}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

function Slot({ r, tz, i }: { r: RoundInfo; tz: string; i: number }) {
  const now = serverNow();
  const opens = ms(r.opens_at);
  const closes = ms(r.closes_at);
  const startsIn = opens - now;
  let chip: ReactNode;
  let action: ReactNode;
  const enter = () => go(`round-${r.id}`);
  if (r.state === 'open') {
    chip = <span className="chip chip-live"><span className="dot dot-live" />Live · {clock(closes - now)} left</span>;
    action = <Button variant="accent" arrow onClick={enter}>{r.progress?.answered ? 'Continue' : 'Enter'}</Button>;
  } else if (r.state === 'paused') {
    chip = <span className="chip chip-warn"><Icon name="pause" size={12} />Paused</span>;
    action = <Button onClick={enter}>Open</Button>;
  } else if (r.state === 'waiting') {
    chip = Number.isFinite(opens) && startsIn < 3600_000
      ? <span className="chip chip-blue">Opens in {clock(startsIn)}</span>
      : <span className="chip">{r.opens_at || r.scheduled_at ? 'Scheduled' : 'Not open yet'}</span>;
    action = <Button onClick={enter}>Rules</Button>;
  } else {
    chip = <span className="chip chip-good"><Icon name="check" size={12} />Done</span>;
    action = r.show_results ? <Button onClick={enter}>See results</Button> : <span className="faint" style={{ fontSize: 13 }}>Closed</span>;
  }
  const when = r.opens_at || r.scheduled_at;
  const progress = r.kind === 'guts'
    ? r.progress?.sets_done ? `${r.progress.sets_done} of ${r.set_count} sets handed in` : ''
    : r.progress?.answered ? `${r.progress.answered} of ${r.problem_count} answered` : '';
  return (
    <div className={`slot ${r.state === 'open' ? 'slot-live' : ''} ${r.state === 'closed' ? 'slot-done' : ''}`} style={{ ['--i' as string]: i }}>
      <div className="slot-time">
        {when ? timeOf(when, tz) : '—'}
        <div className="faint">{r.minutes} min</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="slot-title">{r.title} {chip}</div>
        <div className="slot-blurb">{r.blurb}</div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>{KIND_LABEL[r.kind]}{progress ? ` · ${progress}` : ''}</div>
      </div>
      <div>{action}</div>
    </div>
  );
}
