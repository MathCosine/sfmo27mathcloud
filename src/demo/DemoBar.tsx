import { useState } from 'react';
import { IS_DEMO, backend, useStore, createStore } from '../lib/api';
import { go, storageSet, toast } from '../lib/hooks';
import { studentSignIn, studentSession } from '../lib/session';
import { Icon } from '../ui/icons';
import { Spinner } from '../ui/kit';
import { DEMO_PASSWORD, DEMO_STAFF, DEMO_STUDENT } from './constants';

const ready = createStore(false);
if (IS_DEMO) backend().then(() => ready.set(true)).catch((e) => console.error('demo failed to start', e));

/** The demo's own controls: jump between the people who use the portal. */
export function DemoBar() {
  const isReady = useStore(ready);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState('');

  const asStudent = async () => {
    setBusy('student');
    try {
      await studentSignIn(DEMO_STUDENT.id, DEMO_STUDENT.email);
      go('');
      setOpen(false);
    } catch (e: any) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  };
  const asStaff = async (i: number) => {
    setBusy('staff' + i);
    try {
      const b = await backend();
      await b.staff.signOut();
      await b.staff.signIn(DEMO_STAFF[i].email, DEMO_PASSWORD);
      location.hash = i === 0 ? 'staff' : 'staff-dive';
      setOpen(false);
      window.dispatchEvent(new Event('sfmo-staff-changed'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className={`demobar ${open ? '' : 'demobar-closed'}`}>
      <button className="demobar-tag" onClick={() => setOpen(!open)} aria-expanded={open}>
        {isReady ? <span className="dot dot-live" /> : <Spinner size={12} />}
        Demo
      </button>
      {open && (
        <div className="demobar-body">
          <span className="demobar-note">{isReady ? 'Everything runs in this tab. Bot teams are playing.' : 'Setting up a demo contest…'}</span>
          <div className="demobar-actions">
            <button onClick={asStudent} disabled={!isReady || !!busy}>{busy === 'student' ? <Spinner size={12} /> : <Icon name="user" size={14} />}Student</button>
            <button onClick={() => asStaff(0)} disabled={!isReady || !!busy}>{busy === 'staff0' ? <Spinner size={12} /> : <Icon name="key" size={14} />}Director</button>
            <button onClick={() => asStaff(1)} disabled={!isReady || !!busy}>{busy === 'staff1' ? <Spinner size={12} /> : <Icon name="eye" size={14} />}Proctor</button>
            <button onClick={() => { go('board-mystery'); setOpen(false); }} disabled={!isReady}><Icon name="monitor" size={14} />Projector</button>
            <button
              onClick={() => {
                studentSession.set(null);
                storageSet('sfmo27-outbox-07A', null);
                try { sessionStorage.clear(); } catch { /* ignore */ }
                location.hash = '';
                location.reload();
              }}
              title="Start a fresh demo contest"
            >
              <Icon name="refresh" size={14} />Restart
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
