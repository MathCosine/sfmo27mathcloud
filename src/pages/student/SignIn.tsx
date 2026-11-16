import { useMemo, useState } from 'react';
import { ApiError, IS_DEMO, call } from '../../lib/api';
import { usePoll } from '../../lib/hooks';
import { studentSignIn } from '../../lib/session';
import { DEFAULT_TZ, timeOf, zoneName } from '../../lib/format';
import { Icon } from '../../ui/icons';
import { Brand, Button } from '../../ui/kit';
import { Sonar } from '../../ui/Sonar';
import { DEMO_STUDENT } from '../../demo/constants';

type Info = {
  settings: { event_name: string; event_subtitle: string; event_date: string; timezone: string; signin_open: boolean; signin_closed_message: string; contact_email: string };
  rounds: { id: string; kind: string; title: string; scheduled_at: string | null; minutes: number; state: string }[];
};

const KIND: Record<string, string> = { individual: 'On your own', guts: 'Team · live board', mystery: 'Team · live' };

export function SignIn() {
  const info = usePoll(() => call<Info>('s_info'), 60000);
  const [id, setId] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: 'id' | 'email' } | null>(null);
  const s = info.data?.settings;
  const tz = s?.timezone || DEFAULT_TZ;

  const blips = useMemo(
    () => ['03', '05', '07', '09', '12', '14', '16', '18', '21', '23', '25', '28'].map((t, i) => ({ id: t, score: 60 + ((i * 53) % 140), sunk: i === 9 })),
    [],
  );

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
      const a = err instanceof ApiError ? err : new ApiError(String(err));
      setError({ text: a.message });
    } finally {
      setBusy(false);
    }
  };

  const date = s?.event_date ? new Date(s.event_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  const closed = s && s.signin_open === false;

  return (
    <div className="signin">
      <div className="signin-left">
        <div className="spread">
          <Brand />
          <a className="btn btn-ghost btn-sm" href="#staff">Staff</a>
        </div>
        <form className="signin-form" onSubmit={submit} noValidate>
          <p className="eyebrow" style={{ marginBottom: 14 }}>{s ? `${s.event_subtitle} · ${date}` : 'Online division'}</p>
          <h1 className="signin-title">Sign in to compete.</h1>
          <p className="muted" style={{ marginBottom: 28, maxWidth: 380 }}>Use the student ID from your registration and the email you signed up with. Your teammates sign in on their own devices.</p>

          {closed && (
            <div className="banner banner-live" style={{ marginBottom: 18 }}>
              <Icon name="clock" />
              <div>{s.signin_closed_message || 'Sign-in is closed right now.'}</div>
            </div>
          )}

          <div className="stack" style={{ gap: 16 }}>
            <div className="field">
              <label htmlFor="sid">Student ID</label>
              <input id="sid" className="input input-lg mono" placeholder="07A" value={id} autoComplete="username" autoCapitalize="characters" spellCheck={false}
                aria-invalid={error?.field === 'id' || undefined}
                onChange={(e) => setId(e.target.value.toUpperCase())} />
            </div>
            <div className="field">
              <label htmlFor="semail">Email</label>
              <input id="semail" className="input input-lg" type="email" placeholder="you@example.com" value={email} autoComplete="email" spellCheck={false}
                aria-invalid={error?.field === 'email' || undefined}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && (
              <div className="banner banner-bad" role="alert">
                <Icon name="alert" />
                <div>{error.text}</div>
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" busy={busy} arrow block disabled={!!closed}>Sign in</Button>
          </div>

          {IS_DEMO && (
            <div className="sunk" style={{ marginTop: 22, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="grow" style={{ fontSize: 13.5 }}>
                <span className="eyebrow">Demo login</span>
                <div className="mono" style={{ marginTop: 2 }}>{DEMO_STUDENT.id} · {DEMO_STUDENT.email}</div>
              </div>
              <Button size="sm" onClick={() => { setId(DEMO_STUDENT.id); setEmail(DEMO_STUDENT.email); setError(null); }}>Fill in</Button>
            </div>
          )}

          <p className="faint" style={{ fontSize: 13, marginTop: 26 }}>
            Can't sign in? Tell your proctor in Zoom{s?.contact_email ? <>, or email <span className="mono" style={{ color: 'var(--ink-2)' }}>{s.contact_email}</span></> : ''}.
          </p>
        </form>
      </div>

      <aside className="signin-right" aria-label="Today's rounds">
        <div className="spread">
          <span className="eyebrow" style={{ color: 'var(--deep-ink-2)' }}>{s?.event_name ?? 'SFMO 2027'} · Online</span>
          <span className="eyebrow mono" style={{ color: 'var(--deep-ink-2)' }}>Times in {zoneName(tz)}</span>
        </div>
        <div className="signin-dial">
          <div><Sonar blips={blips} me="07" labels={false} decorative /></div>
        </div>
        {info.data && info.data.rounds.length > 0 && (
          <div style={{ borderRadius: 18, border: '1px solid var(--deep-line)', padding: '4px 18px', maxWidth: 460, width: '100%' }}>
            {info.data.rounds.filter((r) => r.id !== 'practice').map((r, i, all) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '78px 1fr auto', gap: 12, alignItems: 'baseline', padding: '11px 0', borderBottom: i < all.length - 1 ? '1px solid var(--deep-line)' : 0 }}>
                <span className="mono" style={{ fontSize: 13, color: 'var(--deep-ink-2)' }}>{r.scheduled_at ? timeOf(r.scheduled_at, tz) : 'TBA'}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>{r.title}</span>
                <span style={{ fontSize: 12.5, color: 'var(--deep-ink-2)' }}>{KIND[r.kind]}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
