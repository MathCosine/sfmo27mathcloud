import { useState } from 'react';
import { ApiError, IS_DEMO, call, signedOut, useStore } from '../../lib/api';
import { usePoll } from '../../lib/hooks';
import { studentSignIn } from '../../lib/session';
import { DEFAULT_TZ, timeOf, zoneName } from '../../lib/format';
import { BridgeMark, Icon } from '../../ui/icons';
import { Button } from '../../ui/kit';
import { DEMO_STUDENT } from '../../demo/constants';

type Info = {
  settings: { event_name: string; event_subtitle: string; event_date: string; timezone: string; signin_open: boolean; signin_closed_message: string; contact_email: string };
  rounds: { id: string; kind: string; title: string; scheduled_at: string | null; minutes: number; state: string }[];
};

const FORMAT: Record<string, string> = {
  individual: 'On your own, in full screen',
  guts: 'With your team, on Zoom',
  mystery: 'With your team, on Zoom, live',
};

/** The sign-in page, set like the cover sheet of a contest booklet. */
export function SignIn() {
  const info = usePoll(() => call<Info>('s_info'), 60000);
  const why = useStore(signedOut);
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: 'id' | 'email' } | null>(null);
  const s = info.data?.settings;
  const tz = s?.timezone || DEFAULT_TZ;
  const closed = s && s.signin_open === false;
  const date = s?.event_date ? new Date(s.event_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  const rounds = (info.data?.rounds ?? []).filter((r) => r.id !== 'practice');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setError({ text: 'Enter your student ID.', field: 'id' });
    if (!email.trim()) return setError({ text: 'Enter the email you registered with.', field: 'email' });
    setBusy(true);
    setError(null);
    try {
      await studentSignIn(id, email);
      location.hash = '';
    } catch (err) {
      setError({ text: err instanceof ApiError ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cover">
      <div className="cover-top wrap">
        <span className="label-sm">{s?.event_name ?? 'SFMO 2027'} · testing portal</span>
        <a className="linkish" href="#staff" style={{ fontSize: 14 }}>Staff sign-in</a>
      </div>
      <main className="cover-sheet">
        <div className="cover-head">
          <BridgeMark scale={2.4} color="var(--ink)" />
          <div>
            <h1>San Francisco Math Open 2027</h1>
            <p>{s ? `${s.event_subtitle} · ${date}` : 'Online division'}</p>
          </div>
        </div>

        <form className="cover-sec" onSubmit={submit} noValidate>
          <h2>Sign in</h2>
          {why && why !== 'Sign in to continue.' && (
            <div className="banner banner-urgent" style={{ marginBottom: 14 }}><Icon name="logout" /><div>{why}</div></div>
          )}
          {closed && (
            <div className="banner banner-live" style={{ marginBottom: 14 }}><Icon name="clock" /><div>{s.signin_closed_message || 'Sign-in is closed right now.'}</div></div>
          )}
          <div className="cover-fields">
            <div className="field">
              <label htmlFor="sid">Student ID</label>
              <input id="sid" className="input input-lg mono" placeholder="07A" value={id} autoComplete="username" autoCapitalize="characters" spellCheck={false}
                aria-invalid={error?.field === 'id' || undefined} onChange={(e) => setId(e.target.value.toUpperCase())} />
            </div>
            <div className="field">
              <label htmlFor="semail">Email you registered with</label>
              <input id="semail" className="input input-lg" type="email" placeholder="you@example.com" value={email} autoComplete="email" spellCheck={false}
                aria-invalid={error?.field === 'email' || undefined} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" variant="accent" size="lg" busy={busy} arrow disabled={!!closed}>Sign in</Button>
          </div>
          {error && <div className="banner banner-bad" role="alert" style={{ marginTop: 14 }}><Icon name="alert" /><div>{error.text}</div></div>}
          {IS_DEMO && (
            <p className="faint" style={{ fontSize: 13.5, marginTop: 14 }}>
              Demo: <span className="mono" style={{ color: 'var(--ink-2)' }}>{DEMO_STUDENT.id}</span> and <span className="mono" style={{ color: 'var(--ink-2)' }}>{DEMO_STUDENT.email}</span>{' '}
              <button type="button" className="linkish" onClick={() => { setId(DEMO_STUDENT.id); setEmail(DEMO_STUDENT.email); setError(null); }}>fill in</button>
            </p>
          )}
        </form>

        {rounds.length > 0 && (
          <section className="cover-sec">
            <h2>Rounds <span className="faint" style={{ fontWeight: 400 }}>· times in {zoneName(tz)}</span></h2>
            <table className="cover-table">
              <tbody>
                {rounds.map((r) => (
                  <tr key={r.id}>
                    <td>{r.scheduled_at ? timeOf(r.scheduled_at, tz) : 'TBA'}</td>
                    <td>{r.title}</td>
                    <td className="mono" style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.minutes} min</td>
                    <td>{FORMAT[r.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="cover-sec">
          <h2>Instructions</h2>
          <ol className="cover-rules">
            <li>Join your team's Zoom room 20 minutes before each round. Your camera shows you and your desk the whole time.</li>
            <li>Sign in on one device. Signing in somewhere else signs the first one out.</li>
            <li>Individual rounds run in full screen. Leaving full screen or switching tabs hides the problems and is recorded.</li>
            <li>Team rounds start with a check-in: you're in your team's Zoom room with your camera and microphone on.</li>
            <li>Pencil, paper and a ruler are fine. No calculators, notes, other people or AI tools.</li>
            <li>Answers save as you type. If your connection drops, keep working: they send themselves when it's back.</li>
            <li>A proctor can pause your screen if something isn't right. Fix it and tell them in Zoom.</li>
          </ol>
        </section>

        <div className="cover-foot">
          <span>Can't sign in? Tell your proctor in Zoom{s?.contact_email ? <>, or email <span className="mono" style={{ color: 'var(--ink-2)' }}>{s.contact_email}</span></> : ''}.</span>
          <span>Registration and results: sfmathopen.org</span>
        </div>
      </main>
    </div>
  );
}
