import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, createStore, serverNow } from '../../lib/api';
import { go, storageGet, storageSet, usePoll, useTick } from '../../lib/hooks';
import { studentSignOut, token, useStudent } from '../../lib/session';
import { clock, dateOf, DEFAULT_TZ, ms, timeOf, zoneName } from '../../lib/format';
import { Icon } from '../../ui/icons';
import { Brand, Button, ConnectionPill, ErrorNote, Initials, PageLoading } from '../../ui/kit';
import { RoundPage } from './RoundPage';
import { heartbeat } from '../../lib/proctor';

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
    const h = await call<Home>('s_home', { token: token(), hb: roundId ? undefined : heartbeat('') });
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

const KIND_LABEL: Record<string, string> = { individual: 'On your own', guts: 'Team', mystery: 'Team, live' };

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
  const rounds = home.rounds;
  const online = home.team.members.filter((m) => m.online).length;
  return (
    <>
      <section className="hello">
        <div>
          <p className="label-sm">Team {home.team.id} · {home.settings.event_name} {home.settings.event_subtitle?.toLowerCase()}</p>
          <h1>{home.team.name}</h1>
          <p className="members-inline">
            {home.team.members.map((m, i) => (
              <span key={m.id}>{i > 0 && ' · '}{m.name}{m.id === home.me.id ? ' (you)' : ''}</span>
            ))}
            <span className="faint"> — {online} of {home.team.members.length} signed in</span>
          </p>
        </div>
        {home.team.room_url && (
          <a className="btn btn-lg" href={home.team.room_url} target="_blank" rel="noreferrer">
            <Icon name="video" />
            Your team's Zoom room
            <Icon name="external" size={15} />
          </a>
        )}
      </section>

      <div className="home-grid">
        <div className="stack" style={{ gap: 22, minWidth: 0 }}>
          <NextUp rounds={rounds} tz={tz} />
          <Announcements items={home.announcements} />
          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <h2>Schedule</h2>
              <span className="faint mono" style={{ fontSize: 12.5 }}>{dateOf(new Date(serverNow()).toISOString(), tz)} · {zoneName(tz)}</span>
            </div>
            <div className="timetable">
              {rounds.map((r, i) => <Slot key={r.id} r={r} tz={tz} i={i} />)}
            </div>
          </div>
        </div>
        <aside>
          <div className="side-card">
            <h3>Your team</h3>
            {home.team.members.map((m) => (
              <div key={m.id} className="member">
                <Initials name={m.name} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{m.name}{m.id === home.me.id && <span className="faint"> (you)</span>}</div>
                  <div className="faint mono" style={{ fontSize: 12 }}>{m.id}</div>
                </div>
                <span className={`presence ${m.online ? 'on' : ''}`} title={m.online ? 'Signed in now' : 'Not signed in right now'} />
              </div>
            ))}
          </div>
          <div className="side-card">
            <h3>During every round</h3>
            <ol className="checklist">
              <li>Camera on in Zoom, showing you and your desk.</li>
              <li>Individual rounds: full screen, nothing else open.</li>
              <li>Team rounds: check in, microphone on.</li>
              <li>Pencil and paper only. No calculators.</li>
            </ol>
          </div>
          <div className="side-card">
            <h3>Need help?</h3>
            <p className="muted" style={{ fontSize: 14 }}>{home.settings.help_text}</p>
            {home.settings.contact_email && <p className="mono" style={{ fontSize: 13, marginTop: 8 }}>{home.settings.contact_email}</p>}
          </div>
        </aside>
      </div>
    </>
  );
}

/** The one thing to do now: the open round, or the next one and when it opens. */
function NextUp({ rounds, tz }: { rounds: RoundInfo[]; tz: string }) {
  const now = serverNow();
  const live = rounds.find((r) => r.state === 'open' && r.id !== 'practice') ?? rounds.find((r) => r.state === 'open' || r.state === 'paused');
  if (live) {
    return (
      <div className="next-up live">
        <div>
          <span className="label-sm" style={{ color: 'var(--accent-ink)' }}><span className="dot dot-live" style={{ display: 'inline-block', marginRight: 7, verticalAlign: 1 }} />{live.state === 'paused' ? 'Paused' : 'Open now'}</span>
          <div style={{ fontWeight: 600, fontSize: 21, letterSpacing: '-0.02em', marginTop: 2 }}>{live.title}</div>
          <div className="muted" style={{ fontSize: 14 }}>{live.state === 'paused' ? 'The proctors paused it; the clock waits.' : `${clock(ms(live.closes_at) - now)} left${live.progress?.answered ? ` · ${live.progress.answered} answered` : ''}`}</div>
        </div>
        <Button variant="accent" size="lg" arrow onClick={() => go(`round-${live.id}`)}>{live.progress?.answered ? 'Continue' : 'Start'}</Button>
      </div>
    );
  }
  const next = rounds.filter((r) => r.state === 'waiting' && (r.opens_at || r.scheduled_at)).sort((a, b) => ms(a.opens_at ?? a.scheduled_at) - ms(b.opens_at ?? b.scheduled_at))[0];
  if (next) {
    const at = next.opens_at ?? next.scheduled_at;
    return (
      <div className="next-up">
        <div>
          <span className="label-sm">Next: {next.title}</span>
          <div className="when">{next.opens_at ? `opens in ${clock(ms(next.opens_at) - now)}` : timeOf(at, tz)}</div>
          <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{next.opens_at ? `At ${timeOf(next.opens_at, tz)}. ` : 'Planned time. '}Be in your Zoom room 20 minutes before.</div>
        </div>
        <Button onClick={() => go(`round-${next.id}`)}>Read the rules</Button>
      </div>
    );
  }
  return (
    <div className="next-up">
      <div><span className="label-sm">Nothing open right now</span><div className="muted" style={{ marginTop: 2 }}>Rounds appear here when your proctors open them.</div></div>
    </div>
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
    chip = <span className="chip chip-live"><span className="dot dot-live" />Open · {clock(closes - now)} left</span>;
    action = <Button variant="primary" arrow onClick={enter}>{r.progress?.answered ? 'Continue' : 'Enter'}</Button>;
  } else if (r.state === 'paused') {
    chip = <span className="chip chip-warn"><Icon name="pause" size={12} />Paused</span>;
    action = <Button onClick={enter}>Open</Button>;
  } else if (r.state === 'waiting') {
    chip = Number.isFinite(opens) && startsIn < 3600_000
      ? <span className="chip chip-blue">Opens in {clock(startsIn)}</span>
      : <span className="chip">{r.opens_at || r.scheduled_at ? 'Scheduled' : 'Not open yet'}</span>;
    action = <Button onClick={enter}>Rules</Button>;
  } else {
    chip = <span className="chip"><Icon name="check" size={12} />Done</span>;
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
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>{KIND_LABEL[r.kind]}{r.config?.fullscreen ? ' · full screen' : ''}{r.config?.zoom_checkin ? ' · Zoom check-in' : ''}{progress ? ` · ${progress}` : ''}</div>
      </div>
      <div>{action}</div>
    </div>
  );
}
