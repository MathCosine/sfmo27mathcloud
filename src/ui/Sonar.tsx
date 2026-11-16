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
  // Rings at round scores (¾, ½, ¼ of the top, and 0), placed on the same square-root scale as the blips.
  const rings = [0.75, 0.5, 0.25, 0].map((f) => ({ k: Math.sqrt(1 - f), score: Math.round(top * f) }));
  return (
    <svg className="sonar" viewBox="0 0 400 400" role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : 'Depth sonar: the centre is the surface, the edge is Rock Bottom'}>
      <defs>
        <radialGradient id="sonar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#12455f" />
          <stop offset="100%" stopColor="#0a2c40" />
        </radialGradient>
        <linearGradient id="sonar-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#f2b52c" stopOpacity="0" />
          <stop offset="100%" stopColor="#f2b52c" stopOpacity="0.42" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 24} fill="url(#sonar-bg)" />
      <path d={ticks} stroke="#3d6a83" strokeWidth="1.2" />
      {rings.map(({ k }) => (
        <circle key={k} cx={C} cy={C} r={R * k} fill="none" stroke="#1d4a63" strokeWidth={k === 1 ? 1.4 : 1} />
      ))}
      <path d={`M${C - R} ${C}H${C + R}M${C} ${C - R}V${C + R}`} stroke="#1d4a63" strokeWidth="1" />
      {labels && rings.map(({ k, score }) => (
        <text key={k} x={C + 4} y={C - R * k + 12} fontSize="9.5">{score}</text>
      ))}
      <g className="sweep">
        <path d={`M${C} ${C}L${C + R} ${C}A${R} ${R} 0 0 0 ${C + R * Math.cos(-0.55)} ${C + R * Math.sin(-0.55)}Z`} fill="url(#sonar-sweep)" />
        <path d={`M${C} ${C}L${C + R} ${C}`} stroke="#f2b52c" strokeWidth="1.4" />
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
            <circle key={Math.round(b.score / 10)} className="ping" r="4" fill="none" stroke={mine ? '#f2b52c' : '#9ed3ea'} strokeWidth="1.5" />
            {b.sunk ? (
              <circle r="4.5" fill="none" stroke="#e2624a" strokeWidth="1.6" />
            ) : mine ? (
              // Your team is the yellow submarine.
              <g>
                <rect x={-9} y={-4} width={18} height={8} rx={4} fill="#f2b52c" stroke="#0a2b3f" strokeWidth="1" />
                <rect x={-2} y={-8} width={5} height={4} rx={1} fill="#f2b52c" stroke="#0a2b3f" strokeWidth="1" />
                <circle cx={3} cy={0} r={1.6} fill="#0a2b3f" />
              </g>
            ) : (
              <circle r={4.5} fill="#e4f3fb" />
            )}
            {labels && (
              <text x={mine ? 12 : 8} y={4} fontSize="10.5" style={{ fill: mine ? '#f2b52c' : '#8fb2c4' }}>{b.id}</text>
            )}
          </g>
        );
      })}
      <circle cx={C} cy={C} r="3" fill="#f2b52c" />
    </svg>
  );
});
