import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, IS_DEMO, backend, call, serverNow, staffRecovery, useStore, type StaffUser } from '../../lib/api';
import { go, toast, usePoll, useTick } from '../../lib/hooks';
import { DEFAULT_TZ, timeOf } from '../../lib/format';
import { BridgeMark, Icon } from '../../ui/icons';
import { Button, ConnectionPill, CopyButton, ErrorNote, Initials, PageLoading } from '../../ui/kit';
import { DEMO_PASSWORD, DEMO_STAFF } from '../../demo/constants';
import { ControlRoom } from './Control';
import { Dive } from './Dive';
import { RoundsList, RoundEditor } from './Rounds';
import { Roster } from './Roster';
import { Results } from './Results';
import { Activity, DangerZone, EventSettings, Integrity, StaffTeam } from './Admin';

export type StaffRound = {
  id: string; kind: 'individual' | 'guts' | 'mystery'; title: string; blurb: string; rules: string; sort: number;
  minutes: number; grace_seconds: number; scheduled_at: string | null; opens_at: string | null; closes_at: string | null;
  paused: boolean; paused_at: string | null; state: 'waiting' | 'open' | 'paused' | 'closed'; visible: boolean; show_results: boolean;
  config: Record<string, any>; problem_count: number; set_count: number; keys_missing: number; entrants: number; responses: number;
};
export type StaffState = {
  now: string;
  me: { user_id: string; email: string; name: string; role: 'admin' | 'proctor' };
  settings: Record<string, any>;
  rounds: StaffRound[];
  counts: { teams: number; students: number; online: number; signed_in: number; flags: number };
  announcements: { id: number; at: string; text: string; tone: string; round_id: string | null; by: string }[];
};

const Ctx = createContext<{ s: StaffState; refresh: () => Promise<void>; admin: boolean; tz: string } | null>(null);
export function useStaff() {
  const c = useContext(Ctx);
  if (!c) throw new Error('outside staff');
  return c;
}

type Me = { user: StaffUser | null; staff: StaffState['me'] | null; has_admin: boolean };

export default function StaffApp({ route }: { route: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const recovering = useStore(staffRecovery);
  const load = useCallback(async () => {
    try {
      const b = await backend();
      const user = await b.staff.current();
      if (!user) return setMe({ user: null, staff: null, has_admin: true });
      const r = await call<Me>('st_me');
      setMe({ ...r, user });
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(String(e)));
    }
  }, []);
  useEffect(() => {
    load();
    const on = () => load();
    window.addEventListener('sfmo-staff-changed', on);
    return () => window.removeEventListener('sfmo-staff-changed', on);
  }, [load]);

  if (recovering) return <AuthFrame><NewPassword /></AuthFrame>;
  if (error && !me) return <AuthFrame><ErrorNote error={error} onRetry={load} /></AuthFrame>;
  if (!me) return <div className="wrap"><PageLoading /></div>;
  if (!me.user) return <AuthFrame><StaffSignIn onDone={load} /></AuthFrame>;
  if (!me.staff) return <AuthFrame><JoinStaff me={me} onDone={load} /></AuthFrame>;
  return <StaffShell route={route} onSignOut={load} />;
}

// ---------------------------------------------------------------- auth

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="shell" style={{ background: 'var(--bg-sunk)' }}>
      <div className="wrap" style={{ paddingBlock: 22 }}>
        <div className="spread">
          <a className="brand" href="#"><BridgeMark /><span className="brand-name">SFMO 2027</span><span className="brand-sep" /><span className="brand-sub">Staff</span></a>
          <a className="btn btn-ghost btn-sm" href="#"><Icon name="back" size={15} />Student sign-in</a>
        </div>
      </div>
      <main style={{ display: 'grid', placeItems: 'center', padding: '24px 16px 80px' }}>
        <div className="panel" style={{ width: 'min(440px, 100%)', padding: 30, boxShadow: 'var(--shadow-2)', animation: 'rise .45s var(--spring) both' }}>{children}</div>
      </main>
    </div>
  );
}

function StaffSignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up' | 'forgot'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'good'; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const b = await backend();
      if (mode === 'in') {
        await b.staff.signIn(email.trim(), pw);
        onDone();
      } else if (mode === 'up') {
        if (pw.length < 8) throw new ApiError('Use at least 8 characters for your password.');
        const r = await b.staff.signUp(email.trim(), pw);
        if (r.confirm) setMsg({ tone: 'good', text: 'Check your email to confirm the account, then sign in.' });
        else onDone();
      } else {
        await b.staff.resetPassword(email.trim());
        setMsg({ tone: 'good', text: 'If that email has an account, a reset link is on its way.' });
      }
    } catch (err) {
      setMsg({ tone: 'bad', text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 16 }}>
      <div>
        <span className="eyebrow">Proctors and organisers</span>
        <h2 style={{ marginTop: 6 }}>{mode === 'in' ? 'Staff sign-in' : mode === 'up' ? 'Create a staff account' : 'Reset your password'}</h2>
        {mode === 'up' && <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>After this you'll enter the invite code an admin gave you.</p>}
      </div>
      <div className="field"><label htmlFor="st-email">Email</label><input id="st-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></div>
      {mode !== 'forgot' && <div className="field"><label htmlFor="st-pw">Password</label><input id="st-pw" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} required /></div>}
      {msg && <div className={`banner ${msg.tone === 'bad' ? 'banner-bad' : 'banner-good'}`}><Icon name={msg.tone === 'bad' ? 'alert' : 'check'} /><div>{msg.text}</div></div>}
      <Button type="submit" variant="primary" block busy={busy} arrow>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
      <div className="spread" style={{ fontSize: 13.5 }}>
        {mode === 'in' ? <button type="button" className="linkish" onClick={() => setMode('up')}>Create an account</button> : <button type="button" className="linkish" onClick={() => setMode('in')}>Back to sign-in</button>}
        {mode === 'in' && <button type="button" className="linkish" onClick={() => setMode('forgot')}>Forgot password?</button>}
      </div>
      {IS_DEMO && (
        <div className="sunk" style={{ padding: '12px 14px', fontSize: 13 }}>
          <span className="eyebrow">Demo accounts · password "{DEMO_PASSWORD}"</span>
          <div className="row" style={{ marginTop: 8 }}>
            {DEMO_STAFF.map((s) => (
              <Button key={s.email} size="xs" onClick={() => { setEmail(s.email); setPw(DEMO_PASSWORD); setMode('in'); }}>{s.name} · {s.role}</Button>
            ))}
          </div>
        </div>
      )}
    </form>
  );
}

function NewPassword() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <form className="stack" style={{ gap: 16 }} onSubmit={async (e) => {
      e.preventDefault();
      if (pw.length < 8) return setErr('Use at least 8 characters.');
      setBusy(true);
      try {
        await (await backend()).staff.updatePassword(pw);
        toast('Password updated.', 'good');
        go('staff');
      } catch (x) {
        setErr(x instanceof ApiError ? x.message : String(x));
      } finally {
        setBusy(false);
      }
    }}>
      <h2>Choose a new password</h2>
      <div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
      {err && <div className="banner banner-bad"><Icon name="alert" /><div>{err}</div></div>}
      <Button type="submit" variant="primary" busy={busy}>Save password</Button>
    </form>
  );
}

function JoinStaff({ me, onDone }: { me: Me; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sql = `select sfmo_make_admin('${me.user?.email ?? 'you@example.com'}');`;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <span className="eyebrow">Signed in as {me.user?.email}</span>
        <h2 style={{ marginTop: 6 }}>Join the staff</h2>
        <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>Enter the invite code an admin made for you under Staff.</p>
      </div>
      <form className="stack" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          await call('st_redeem', { code, name });
          toast('Welcome to the staff.', 'good');
          onDone();
        } catch (x) {
          setErr(x instanceof ApiError ? x.message : String(x));
        } finally {
          setBusy(false);
        }
      }}>
        <div className="field"><label htmlFor="jn">Your name</label><input id="jn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shown on announcements and in the log" /></div>
        <div className="field"><label htmlFor="jc">Invite code</label><input id="jc" className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" /></div>
        {err && <div className="banner banner-bad"><Icon name="alert" /><div>{err}</div></div>}
        <Button type="submit" variant="primary" busy={busy} disabled={!code.trim()}>Join</Button>
      </form>
      {!me.has_admin && (
        <div className="sunk" style={{ padding: 16 }}>
          <b>Setting this up for the first time?</b>
          <p className="muted" style={{ fontSize: 13.5, margin: '6px 0 10px' }}>There's no admin yet. In Supabase, open the SQL editor and run this once to make this account the first admin, then reload:</p>
          <div className="row"><code className="mono grow" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{sql}</code><CopyButton text={sql} /></div>
        </div>
      )}
      <Button variant="ghost" icon="logout" onClick={async () => { await (await backend()).staff.signOut(); onDone(); }}>Sign out</Button>
    </div>
  );
}

// ---------------------------------------------------------------- shell

const NAV: { to: string; label: string; icon: string; admin?: boolean; group?: string }[] = [
  { to: 'staff', label: 'Control room', icon: 'signal', group: 'Live' },
  { to: 'staff-dive', label: 'Mystery console', icon: 'sub' },
  { to: 'staff-integrity', label: 'Tab switches', icon: 'eye' },
  { to: 'staff-rounds', label: 'Rounds & problems', icon: 'list', group: 'Set up' },
  { to: 'staff-roster', label: 'Teams & students', icon: 'users' },
  { to: 'staff-results', label: 'Results', icon: 'chart' },
  { to: 'staff-team', label: 'Staff & invites', icon: 'key', admin: true, group: 'Admin' },
  { to: 'staff-event', label: 'Event settings', icon: 'gear', admin: true },
  { to: 'staff-activity', label: 'Activity log', icon: 'scroll', admin: true },
  { to: 'staff-reset', label: 'Reset & clean up', icon: 'refresh', admin: true },
];

function StaffShell({ route, onSignOut }: { route: string; onSignOut: () => void }) {
  const st = usePoll(() => call<StaffState>('st_state'), 4000);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  if (!st.data) return <div className="wrap">{st.error ? <div className="page"><ErrorNote error={st.error} onRetry={st.refresh} /></div> : <PageLoading />}</div>;
  const s = st.data;
  const admin = s.me.role === 'admin';
  const tz = s.settings.timezone || DEFAULT_TZ;
  const live = s.rounds.filter((r) => r.state === 'open' || r.state === 'paused');
  const nav = NAV.filter((n) => admin || !n.admin);
  const signOut = async () => {
    await (await backend()).staff.signOut();
    onSignOut();
  };

  let page: ReactNode;
  if (route === 'staff') page = <ControlRoom />;
  else if (route === 'staff-dive') page = <Dive />;
  else if (route === 'staff-rounds') page = <RoundsList />;
  else if (route.startsWith('staff-round-')) page = <RoundEditor id={route.slice(12)} />;
  else if (route === 'staff-roster') page = <Roster />;
  else if (route === 'staff-results') page = <Results id={s.rounds.find((r) => r.state !== 'waiting')?.id ?? s.rounds[0]?.id} />;
  else if (route.startsWith('staff-results-')) page = <Results id={route.slice(14)} />;
  else if (route === 'staff-integrity') page = <Integrity />;
  else if (route === 'staff-team' && admin) page = <StaffTeam />;
  else if (route === 'staff-event' && admin) page = <EventSettings />;
  else if (route === 'staff-activity' && admin) page = <Activity />;
  else if (route === 'staff-reset' && admin) page = <DangerZone />;
  else page = <div className="staff-page empty"><h3>Nothing here.</h3><button className="linkish" onClick={() => go('staff')}>Back to the control room</button></div>;

  const isOn = (to: string) => route === to || (to !== 'staff' && route.startsWith(to)) || (to === 'staff-rounds' && route.startsWith('staff-round-'));

  return (
    <Ctx.Provider value={{ s, refresh: st.refresh, admin, tz }}>
      <div className="staff">
        <nav className="side" aria-label="Staff">
          <div className="side-brand">
            <a className="brand" href="#staff"><BridgeMark /><span className="brand-name">SFMO 2027</span></a>
            <span className="eyebrow" style={{ display: 'block', marginTop: 6 }}>{s.settings.event_subtitle} · Staff</span>
          </div>
          {nav.map((n) => (
            <div key={n.to}>
              {n.group && <div className="nav-group eyebrow">{n.group}</div>}
              <a href={'#' + n.to} className={`nav-item ${isOn(n.to) ? 'on' : ''}`}>
                <Icon name={n.icon} size={17} />
                {n.label}
                {n.to === 'staff' && live.length > 0 && <span className="count" style={{ color: 'var(--accent-ink)' }}>{live.length} live</span>}
                {n.to === 'staff-integrity' && s.counts.flags > 0 && <span className="count">{s.counts.flags}</span>}
              </a>
            </div>
          ))}
          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <a className="nav-item" href="#board-mystery" target="_blank" rel="noreferrer"><Icon name="monitor" size={17} />Projector board<Icon name="external" size={13} /></a>
          </div>
        </nav>
        <div className="staff-main">
          <header className="staff-top">
            <div className="mobile-nav">
              <select className="select" style={{ height: 34, width: 'auto' }} value={NAV.find((n) => isOn(n.to))?.to ?? 'staff'} onChange={(e) => go(e.target.value)} aria-label="Go to">
                {nav.map((n) => <option key={n.to} value={n.to}>{n.label}</option>)}
              </select>
            </div>
            <StaffClock tz={tz} />
            <div style={{ marginLeft: 'auto' }} className="row">
              <ConnectionPill />
              <span className="chip chip-outline hide-sm">{s.counts.online} students online</span>
              <div style={{ position: 'relative' }} ref={ref}>
                <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 4 }} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
                  <Initials name={s.me.name || s.me.email} />
                  <span className="hide-sm">{s.me.name || s.me.email}</span>
                  <Icon name="down" size={14} />
                </button>
                {menu && (
                  <div className="menu" role="menu">
                    <div className="menu-label"><div style={{ fontWeight: 600 }}>{s.me.name || s.me.email}</div><div className="faint" style={{ fontSize: 12.5 }}>{s.me.email} · {s.me.role}</div></div>
                    <hr className="rule" style={{ margin: '6px 0' }} />
                    <a className="menu-item" href="#" onClick={() => setMenu(false)}><Icon name="user" size={16} />Student view</a>
                    <button className="menu-item" onClick={signOut}><Icon name="logout" size={16} />Sign out</button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <div className="staff-page" key={route}>{page}</div>
        </div>
      </div>
    </Ctx.Provider>
  );
}

function StaffClock({ tz }: { tz: string }) {
  useTick(1000);
  return <span className="mono" style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{timeOf(new Date(serverNow()).toISOString(), tz, true)}</span>;
}
