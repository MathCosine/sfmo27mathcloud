import { useMemo, useRef, useState } from 'react';
import { call, serverNow } from '../lib/api';
import { clock, DEFAULT_TZ, ms, points } from '../lib/format';
import { usePoll, useTick } from '../lib/hooks';
import { BridgeMark, Icon } from '../ui/icons';
import { ErrorNote } from '../ui/kit';
import { Sonar } from '../ui/Sonar';
import { LiveScore } from '../ui/live';
import { EventBanner, Feed, scoreAt, type BoardRow, type FeedItem } from './student/MysteryRound';

type Data = {
  now: string;
  settings: { event_name: string; event_subtitle: string };
  round: { id: string; kind: string; title: string; state: string; closes_at: string | null; config: any };
  board: (BoardRow & { sets?: number })[];
  feed: FeedItem[] | null;
};

/** For a projector or a Zoom screen share. Public only if staff switch it on. */
export default function Projector({ round }: { round: string }) {
  const since = useRef(0);
  const readAt = useRef(0);
  const first = useRef(true);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [banner, setBanner] = useState<FeedItem | null>(null);
  const data = usePoll(async () => {
    const d = await call<Data>('public_board', { round, since: since.current });
    readAt.current = Date.parse(d.now);
    if (d.feed?.length) {
      since.current = Math.max(since.current, ...d.feed.map((f) => f.id));
      setFeed((p) => [...d.feed!.slice().reverse(), ...p].slice(0, 40));
      if (!first.current) {
        const ev = d.feed.filter((f) => f.kind === 'event').pop();
        if (ev) setBanner(ev);
      }
    }
    first.current = false;
    return d;
  }, 2000, [round]);
  useTick(1000);
  const d = data.data;
  const names = useMemo(() => Object.fromEntries((d?.board ?? []).map((b) => [b.id, b.name])), [d?.board]);

  if (!d) return <div className="projector">{data.error ? <ErrorNote error={data.error} onRetry={data.refresh} /> : <p style={{ color: 'var(--deep-ink-2)' }}>Loading the board…</p>}</div>;
  const mystery = d.round.kind === 'mystery';
  const t = serverNow();
  const rows = mystery ? [...d.board].sort((a, b) => scoreAt(b, readAt.current, t) - scoreAt(a, readAt.current, t)) : d.board;
  const left = ms(d.round.closes_at) - t;

  return (
    <div className="projector">
      <header className="spread">
        <div className="row" style={{ gap: 14 }}>
          <BridgeMark scale={1.6} color="#e8edf7" />
          <div>
            <span className="eyebrow">{d.settings.event_name} · {d.settings.event_subtitle}</span>
            <h1 style={{ fontSize: 40, color: 'var(--deep-ink)' }}>{d.round.title}</h1>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="eyebrow">{d.round.state === 'open' ? 'Time left' : d.round.state === 'paused' ? 'Paused' : d.round.state === 'closed' ? 'Final' : 'Starting soon'}</span>
          <div className="clock" style={{ fontSize: 54, color: 'var(--deep-ink)' }}>{d.round.state === 'open' && Number.isFinite(left) ? clock(left) : '—'}</div>
        </div>
      </header>
      <div className={mystery ? 'projector-grid' : ''} style={mystery ? undefined : { maxWidth: 980, width: '100%', margin: '0 auto' }}>
        {mystery && (
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 'min(640px, 100%, calc(100vh - 190px))' }}>
              <Sonar blips={d.board.map((b) => ({ id: b.id, score: scoreAt(b, readAt.current), sunk: b.sunk }))} max={Number(d.round.config.start ?? 200)} />
            </div>
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          {rows.slice(0, mystery ? 12 : 16).map((b, i) => (
            <div key={b.id} className={`pboard-row ${b.sunk ? 'sunk' : ''}`}>
              <span className="mono" style={{ color: 'var(--deep-ink-2)' }}>{i + 1}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><span className="mono" style={{ color: 'var(--deep-ink-2)', marginRight: 10 }}>{b.id}</span>{b.name}</span>
              <span className="score">{mystery ? (b.sunk ? <span style={{ color: '#ff7a5c', fontSize: 18 }}>ROCK BOTTOM</span> : <LiveScore row={b} readAt={readAt.current} />) : points(b.score)}</span>
            </div>
          ))}
          {mystery && (
            <div style={{ marginTop: 22, background: 'var(--bg)', color: 'var(--ink)', borderRadius: 18, padding: '8px 16px' }}>
              <Feed items={feed.slice(0, 3)} names={names} tz={DEFAULT_TZ} />
            </div>
          )}
        </div>
      </div>
      <footer className="row" style={{ color: 'var(--deep-ink-2)', fontSize: 13 }}><Icon name="signal" size={14} />Live · updates every two seconds</footer>
      {banner && <EventBanner f={banner} onDone={() => setBanner(null)} />}
    </div>
  );
}
