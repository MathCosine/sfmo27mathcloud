import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { connection, useStore } from '../lib/api';
import { toasts } from '../lib/hooks';
import { rich, tex } from '../lib/rich';
import { BridgeMark, Icon } from './icons';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'accent' | 'ghost' | 'danger' | 'good' | 'default';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  busy?: boolean;
  icon?: string;
  arrow?: boolean;
  block?: boolean;
};

export function Button({ variant = 'default', size = 'md', busy, icon, arrow, block, children, className = '', disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', !children && 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={size === 'lg' ? 19 : 16} /> : null}
      {children}
      {arrow && !busy && <Icon name="arrow" size={16} className="arrow" />}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="spin" width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M17 10a7 7 0 0 0-7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Check({ size = 16 }: { size?: number }) {
  return (
    <svg className="check-draw" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </svg>
  );
}

export function Brand({ sub = 'Online', compact = false }: { sub?: string; compact?: boolean }) {
  return (
    <a className="brand" href="#">
      <BridgeMark />
      <span className="brand-name">SFMO 2027</span>
      {!compact && <span className="brand-sep" />}
      {!compact && <span className="brand-sub">{sub}</span>}
    </a>
  );
}

export function ConnectionPill() {
  const c = useStore(connection);
  const label = c.state === 'ok' ? 'Connected' : c.state === 'offline' ? 'Offline' : 'Reconnecting';
  return (
    <span className={`conn conn-${c.state}`} role="status" aria-live="polite" title={c.state === 'ok' ? 'Connected to the contest server' : 'Your answers are kept on this device and sent when the connection is back'}>
      <span className={`dot ${c.state === 'ok' ? 'dot-live' : ''}`} />
      {label}
    </span>
  );
}

export function Toasts() {
  const list = useStore(toasts);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Icon name={t.tone === 'good' ? 'check' : t.tone === 'bad' ? 'alert' : 'info'} size={16} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function Modal({ onClose, children, wide, label }: { onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.btn-primary, button.btn-accent, button');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** A confirmation that asks for a typed word on dangerous actions. */
export function Confirm({ title, body, action, danger, word, onConfirm, onClose }: { title: string; body: ReactNode; action: string; danger?: boolean; word?: string; onConfirm: () => Promise<unknown> | void; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = !word || typed.trim().toUpperCase() === word;
  return (
    <Modal onClose={onClose} label={title}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ok) return;
          setBusy(true);
          try {
            await onConfirm();
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-body stack" style={{ gap: 14 }}>
          <h2>{title}</h2>
          <div className="muted">{body}</div>
          {word && (
            <div className="field">
              <label htmlFor="confirm-word">Type <b className="mono">{word}</b> to confirm</label>
              <input id="confirm-word" className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
        </div>
        <div className="modal-foot">
          <Button onClick={onClose}>Cancel</Button>
          <button type="submit" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!ok || busy}>
            {busy && <Spinner />}
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Rich({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => rich(text), [text]);
  return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Tex({ src }: { src: string }) {
  const html = useMemo(() => tex(src), [src]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Switch({ checked, onChange, id, label }: { checked: boolean; onChange: (v: boolean) => void; id: string; label?: string }) {
  return (
    <label className="check" htmlFor={id}>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  return <span className="avatar">{((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()}</span>;
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      icon={done ? 'check' : 'copy'}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard refused: the text is on screen to select */
        }
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function Skeleton({ h = 18, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}

export function PageLoading() {
  return (
    <div className="stack" style={{ gap: 14, paddingBlock: 40 }} aria-busy="true" aria-label="Loading">
      <Skeleton h={34} w="46%" />
      <Skeleton h={16} w="70%" />
      <div style={{ height: 12 }} />
      <Skeleton h={76} />
      <Skeleton h={76} />
      <Skeleton h={76} />
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="banner banner-bad" role="alert">
      <Icon name="alert" size={18} />
      <div className="grow">{error.message}</div>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Animated number: eases from the previous value to the new one. */
export function Count({ value, digits = 0, className = '' }: { value: number; digits?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    let id = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 600);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (b - a) * e;
      setShown(v);
      from.current = v;
      if (k < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [value]);
  return <span className={`num ${className}`}>{shown.toFixed(digits)}</span>;
}
