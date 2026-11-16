/**
 * The proctoring layer around a round: full screen for individual rounds, a
 * Zoom check-in for team rounds, a proctor's hold, copy protection and the
 * watermark. The database enforces check-ins and holds on its side as well;
 * full screen can only be watched from the browser, so every exit is logged
 * and shown to proctors live.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, call, useStore } from '../../lib/api';
import { clock } from '../../lib/format';
import { enterFullscreen, fullscreenSupported, useFullscreen } from '../../lib/proctor';
import { token, useStudent } from '../../lib/session';
import { Icon } from '../../ui/icons';
import { Button } from '../../ui/kit';
import { homeCache, type RoundInfo } from './StudentApp';

const flag = (round: string, kind: string, ms = 0) =>
  call('s_flag', { token: token(), round, kind, ms, hb: { round, fs: !!document.fullscreenElement, vis: !document.hidden } }).catch(() => {});

/** Full screen for rounds that ask for it. Returns what to show instead of the test, if anything. */
export function useFullscreenRule(round: RoundInfo, onChange: () => void): ReactNode | null {
  const required = !!round.config.fullscreen && (round.state === 'open' || round.state === 'paused');
  const fs = useFullscreen();
  const supported = fullscreenSupported();
  const [entered, setEntered] = useState(false);
  const leftAt = useRef(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!required) return;
    onChange();
    if (fs) {
      setEntered(true);
      if (leftAt.current) {
        flag(round.id, 'fullscreen_exit', Date.now() - leftAt.current);
        leftAt.current = 0;
      }
    } else if (entered) {
      leftAt.current = Date.now();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fs, required]);

  useEffect(() => {
    if (!required || supported) return;
    const key = `sfmo27-nofs-${round.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* fine */
    }
    flag(round.id, 'no_fullscreen');
  }, [required, supported, round.id]);

  useEffect(() => {
    if (!required || fs || !entered) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [required, fs, entered]);

  if (!required || fs) return null;
  if (!supported) return null; // phones without full screen: allowed, and proctors are told
  if (!entered) {
    return (
      <Gate icon="monitor" title={`${round.title} runs in full screen`}>
        <p>When you start, this page fills your screen. Leaving full screen or switching away hides the problems and is recorded for your proctor, with how long you were gone.</p>
        <ul className="gate-list">
          <li>Close other tabs and apps you don't need.</li>
          <li>Pencil and paper are fine. Nothing else.</li>
          <li>Your camera stays on in Zoom even though you can't see it.</li>
        </ul>
        <Button variant="accent" size="lg" icon="monitor" onClick={() => enterFullscreen()}>Enter full screen and start</Button>
      </Gate>
    );
  }
  return (
    <Gate icon="alert" title="You left full screen" tone="bad">
      <p>The problems are hidden until you come back. Away for <b className="mono">{clock(now - (leftAt.current || now))}</b> so far; your proctor can see this.</p>
      <Button variant="accent" size="lg" icon="monitor" onClick={() => enterFullscreen()}>Return to full screen</Button>
    </Gate>
  );
}

function Gate({ icon, title, tone, children }: { icon: string; title: string; tone?: 'bad'; children: ReactNode }) {
  return (
    <div className={`gate ${tone === 'bad' ? 'gate-bad' : ''}`} role="dialog" aria-label={title}>
      <div className="gate-card">
        <span className="gate-icon"><Icon name={icon} size={22} /></span>
        <h2>{title}</h2>
        <div className="gate-body">{children}</div>
      </div>
    </div>
  );
}

/** "In my team's Zoom room, camera on, microphone on", before a team round's problems appear. */
export function CheckIn({ round, onDone }: { round: RoundInfo; onDone: () => void }) {
  const home = useStore(homeCache);
  const me = useStudent()!;
  const [room, setRoom] = useState(false);
  const [camera, setCamera] = useState(false);
  const [mic, setMic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = home?.team.room_url;
  return (
    <div className="wrap wrap-narrow page">
      <div className="checkin">
        <p className="label-sm">{round.title} · Team {me.student.team_id}</p>
        <h1>Check in on Zoom first</h1>
        <p className="muted" style={{ marginTop: 10 }}>Team rounds happen with your team in your Zoom room. Your proctor watches that room: cameras show you and your desk, microphones stay on so the team can talk.</p>
        <div className="checkin-steps">
          <label className={`checkin-step ${room ? 'done' : ''}`}>
            <input type="checkbox" checked={room} onChange={(e) => setRoom(e.target.checked)} />
            <span>
              <b>I'm in Team {me.student.team_id}'s Zoom room</b>
              {url ? <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open the room <Icon name="external" size={13} /></a> : <span className="faint">Your proctor has the link.</span>}
            </span>
          </label>
          <label className={`checkin-step ${camera ? 'done' : ''}`}>
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            <span><b>My camera is on</b><span className="faint">It shows my face and my desk.</span></span>
          </label>
          <label className={`checkin-step ${mic ? 'done' : ''}`}>
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span><b>My microphone is on</b><span className="faint">Unmuted, so my team can hear me.</span></span>
          </label>
        </div>
        {error && <div className="banner banner-bad" style={{ marginTop: 14 }}><Icon name="alert" /><div>{error}</div></div>}
        <div className="row" style={{ marginTop: 20 }}>
          <Button variant="accent" size="lg" busy={busy} disabled={!(room && camera && mic)} onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await call('s_checkin', { token: token(), round: round.id, room, camera, mic });
              onDone();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}>Check in and see the problems</Button>
          <span className="faint" style={{ fontSize: 13 }}>Proctors can pause anyone whose camera or microphone goes off.</span>
        </div>
      </div>
    </div>
  );
}

/** A proctor's hold: covers everything until it's released. */
export function HoldScreen({ reason }: { reason: string }) {
  return createPortal(
    <div className="gate gate-bad gate-fixed" role="alertdialog" aria-label="Paused by your proctor">
      <div className="gate-card">
        <span className="gate-icon"><Icon name="pause" size={22} /></span>
        <h2>Your proctor paused you</h2>
        <div className="gate-body">
          <p className="hold-reason">“{reason.charAt(0).toUpperCase() + reason.slice(1)}”</p>
          <p>Fix it, then tell your proctor in Zoom. This screen unlocks by itself the moment they release you; your answers so far are safe.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The problems' sheet: text can't be selected, copied or right-clicked (tries
 * are logged), and the student's ID is watermarked faintly across it.
 */
export function Paper({ roundId, children, className = '' }: { roundId: string; children: ReactNode; className?: string }) {
  const me = useStudent()!;
  const lastCopy = useRef(0);
  const mark = `${me.student.id} · ${me.student.name}`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><text x='0' y='120' transform='rotate(-18 160 90)' font-family='DM Mono, monospace' font-size='13' fill='%230a2b3f' fill-opacity='0.045'>${mark.replace(/[<>&'"]/g, '')}</text></svg>`;
  const guard = (e: React.ClipboardEvent | React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea')) return;
    e.preventDefault();
    if (e.type === 'copy' && Date.now() - lastCopy.current > 10_000) {
      lastCopy.current = Date.now();
      flag(roundId, 'copy');
    }
  };
  return (
    <div className={`paper ${className}`} style={{ backgroundImage: `url("data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/\s+/g, ' ')}")` }} onCopy={guard} onCut={guard} onContextMenu={guard} onDragStart={guard}>
      {children}
    </div>
  );
}
