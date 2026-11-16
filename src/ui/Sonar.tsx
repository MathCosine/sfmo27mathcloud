import { memo, useMemo } from 'react';

export type Blip = { id: string; name?: string; score: number; sunk?: boolean };

const C = 200;
const R = 172;

/**
 * The Mystery Dive's depth sonar. The centre is the surface, the rim is Rock
 * Bottom; each team keeps its own bearing, and its distance from the centre is
 * how deep it has sunk.
 */
export const Sonar = memo(function Sonar({ blips, me, max = 200, labels = true, decorative = false }: { blips: Blip[]; me?: string; max?: number; labels?: boolean; decorative?: boolean }) {
  const ticks = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const long = i % 10 === 0;
      const r1 = R + 10;
      const r2 = R + (long ? 20 : 15);
      out.push(`M${C + r1 * Math.cos(a)} ${C + r1 * Math.sin(a)}L${C + r2 * Math.cos(a)} ${C + r2 * Math.sin(a)}`);
    }
    return out.join('');
  }, []);
  const top = Math.max(max, ...blips.map((b) => b.score));
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg className="sonar" viewBox="0 0 400 400" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : 'Depth sonar: the centre is the surface, the edge is Rock Bottom'}>
      <defs>
        <radialGradient id="sonar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#16223a" />
          <stop offset="100%" stopColor="#0b1220" />
        </radialGradient>
        <linearGradient id="sonar-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff5a1f" stopOpacity="0" />
          <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 24} fill="url(#sonar-bg)" />
      <path d={ticks} stroke="#3a4866" strokeWidth="1.2" />
      {rings.map((k) => (
        <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="#24304a" strokeWidth={k === 1 ? 1.4 : 1} />
      ))}
      <path d={`M${C - R} ${C}H${C + R}M${C} ${C - R}V${C + R}`} stroke="#24304a" strokeWidth="1" />
      {labels && rings.map((k) => (
        <text key={k} x={C + 4} y={C - R * k + 12} fontSize="9.5">{Math.round(top * (1 - k * k))}</text>
      ))}
      <g className="sweep">
        <path d={`M${C} ${C}L${C + R} ${C}A${R} ${R} 0 0 0 ${C + R * Math.cos(-0.55)} ${C + R * Math.sin(-0.55)}Z`} fill="url(#sonar-sweep)" />
        <path d={`M${C} ${C}L${C + R} ${C}`} stroke="#ff7a45" strokeWidth="1.6" />
      </g>
      {blips.map((b, i) => {
        const angle = (i / Math.max(1, blips.length)) * Math.PI * 2 - Math.PI / 2 + 0.21;
        // Square-root scale: early in the dive everyone is near the surface, so spread them out.
        const depth = b.sunk ? 1 : Math.sqrt(1 - Math.max(0, Math.min(1, b.score / top)));
        const r = 14 + depth * (R - 14);
        const x = C + r * Math.cos(angle);
        const y = C + r * Math.sin(angle);
        const mine = b.id === me;
        return (
          <g key={b.id} className="blip" style={{ transform: `translate(${x}px, ${y}px)` }}>
            <circle key={Math.round(b.score / 10)} className="ping" r="4" fill="none" stroke={mine ? '#ff5a1f' : '#9fb3d9'} strokeWidth="1.5" />
            {b.sunk ? (
              <circle r="4.5" fill="none" stroke="#ff7a5c" strokeWidth="1.6" />
            ) : (
              <circle r={mine ? 6 : 4.5} fill={mine ? '#ff5a1f' : '#e8edf7'} />
            )}
            {labels && (
              <text x={8} y={4} fontSize="10.5" style={{ fill: mine ? '#ffb08f' : '#8b97b0' }}>{b.id}</text>
            )}
          </g>
        );
      })}
      <circle cx={C} cy={C} r="3" fill="#ff5a1f" />
    </svg>
  );
});
