/* A small hand-drawn icon set on a 20-unit grid, 1.6 stroke. */
import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  arrow: <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />,
  back: <path d="M16 10H5M9 5.5 4.5 10 9 14.5" />,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  x: <path d="m5.5 5.5 9 9m0-9-9 9" />,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 2" /></>,
  users: <><circle cx="7.5" cy="7.5" r="2.8" /><path d="M2.5 16c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" /><path d="M13 5.2a2.6 2.6 0 0 1 0 5M14.5 12.3c1.5.5 2.6 1.7 3 3.7" /></>,
  user: <><circle cx="10" cy="7" r="3.2" /><path d="M3.8 17c.8-3.2 3.2-5 6.2-5s5.4 1.8 6.2 5" /></>,
  video: <><rect x="2.5" y="5.5" width="10.5" height="9" rx="2" /><path d="m13 9 4.5-2.5v7L13 11" /></>,
  megaphone: <><path d="M3.5 8v4h3l6 3.5v-11L6.5 8z" /><path d="M6.5 12 7.6 16h2" /><path d="M15.5 8.2a2.5 2.5 0 0 1 0 3.6" /></>,
  flag: <><path d="M5 17.5V3" /><path d="M5 3.5h9l-2 3.5 2 3.5H5" /></>,
  lock: <><rect x="4" y="9" width="12" height="8.5" rx="2" /><path d="M6.8 9V6.5a3.2 3.2 0 0 1 6.4 0V9" /></>,
  play: <path d="M6.5 4.5v11l9-5.5z" />,
  pause: <path d="M7 4.5v11M13 4.5v11" />,
  stop: <rect x="5" y="5" width="10" height="10" rx="1.5" />,
  plus: <path d="M10 4v12M4 10h12" />,
  minus: <path d="M4 10h12" />,
  refresh: <><path d="M15.5 8.5A5.8 5.8 0 0 0 4.7 7" /><path d="M4.5 3.8V7h3.2" /><path d="M4.5 11.5A5.8 5.8 0 0 0 15.3 13" /><path d="M15.5 16.2V13h-3.2" /></>,
  upload: <><path d="M10 13V3.5M6 7.5l4-4 4 4" /><path d="M3.5 13v2.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V13" /></>,
  download: <><path d="M10 3.5V13M6 9l4 4 4-4" /><path d="M3.5 13v2.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V13" /></>,
  down: <path d="m5 7.5 5 5 5-5" />,
  right: <path d="m7.5 5 5 5-5 5" />,
  wrench: <path d="M12.6 3.6a4 4 0 0 0-4.9 5.2L3.4 13a1.8 1.8 0 0 0 2.6 2.6l4.3-4.3a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.2-.6-.6-2.2z" />,
  target: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3.5" /><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" /></>,
  torpedo: <><path d="M3 10c0-1.4 1.1-2.3 2.5-2.3h8.2L17 10l-3.3 2.3H5.5C4.1 12.3 3 11.4 3 10z" /><path d="M5.5 7.7 4 5.5M5.5 12.3 4 14.5" /></>,
  radiation: <><circle cx="10" cy="10" r="1.6" /><path d="M10 3.2a6.8 6.8 0 0 1 5.9 3.4l-4.5 2.6M4.1 6.6A6.8 6.8 0 0 1 10 3.2v5.2M13.4 15.9a6.8 6.8 0 0 1-6.8 0l2.6-4.5h1.6z" /></>,
  lifebuoy: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><path d="m5 5 2.9 2.9M15 5l-2.9 2.9M5 15l2.9-2.9M15 15l-2.9-2.9" /></>,
  wave: <path d="M2 8c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1M2 13c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1" />,
  shield: <path d="M10 2.8 4 5v4.8c0 3.6 2.6 6.4 6 7.4 3.4-1 6-3.8 6-7.4V5z" />,
  bolt: <path d="M11 2.5 4.5 11h5l-1 6.5L15.5 9h-5z" />,
  eye: <><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" /><circle cx="10" cy="10" r="2.4" /></>,
  gear: <><circle cx="10" cy="10" r="2.6" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></>,
  logout: <><path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3" /><path d="M12 6.5 15.5 10 12 13.5M15.5 10H8" /></>,
  copy: <><rect x="7" y="7" width="9.5" height="9.5" rx="2" /><path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" /></>,
  trash: <><path d="M3.5 5.5h13M8 5.5V4h4v1.5" /><path d="M5 5.5 6 16.5h8l1-11" /></>,
  edit: <><path d="M12.5 4 16 7.5 7.5 16H4v-3.5z" /><path d="m10.5 6 3.5 3.5" /></>,
  alert: <><path d="M10 3 2.5 16.5h15z" /><path d="M10 8v4M10 14.2v.1" /></>,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v4.5M10 6.3v.1" /></>,
  sub: <><path d="M2.5 11.5c0-2 1.8-3.5 4-3.5h6.5c2.2 0 4 1.5 4 3.5s-1.8 3.5-4 3.5H6.5c-2.2 0-4-1.5-4-3.5z" /><path d="M8 8V5.5h3.5V8M10 5.5V3.5" /><circle cx="8" cy="11.5" r="1" /><circle cx="11.5" cy="11.5" r="1" /></>,
  anchor: <><circle cx="10" cy="4.5" r="1.8" /><path d="M10 6.3V17M6.5 9h7M3.5 11.5c.5 3.2 3.2 5.5 6.5 5.5s6-2.3 6.5-5.5" /></>,
  tentacle: <path d="M6 17c-2-2-2-5 0-7s5-2 6 0-1 3-2.5 2.2S9 10 10.5 9.5c2.5-.8 4-3.5 3-6.5M14 17c1.5-1.2 2.5-3 2.5-5" />,
  gift: <><rect x="3.5" y="8" width="13" height="8.5" rx="1.5" /><path d="M2.8 6h14.4v2H2.8zM10 6v10.5M10 6C9 3.5 6 3.5 6.2 5.2 6.4 6.2 10 6 10 6zm0 0c1-2.5 4-2.5 3.8-.8-.2 1-3.8.8-3.8.8z" /></>,
  fin: <path d="M2 15.5h16M5 15.5c1.5-5 5-9.5 10-11-1.5 3-2 7.5-1 11" />,
  bubbles: <><circle cx="7" cy="12.5" r="3.5" /><circle cx="13.5" cy="7" r="2.5" /><circle cx="14" cy="14" r="1.5" /></>,
  snow: <path d="M10 2.5v15M3.5 6.2l13 7.6M3.5 13.8l13-7.6M8 3.8 10 5.5l2-1.7M8 16.2l2-1.7 2 1.7" />,
  chart: <path d="M3 16.5h14M5.5 16.5V10M9.5 16.5V5.5M13.5 16.5V12" />,
  monitor: <><rect x="2.5" y="3.5" width="15" height="10" rx="1.8" /><path d="M7 17h6M10 13.5V17" /></>,
  list: <path d="M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.1M3.5 10h.1M3.5 14.5h.1" />,
  home: <><path d="M3 9 10 3.5 17 9" /><path d="M5 8v8.5h10V8" /></>,
  key: <><circle cx="6.5" cy="13" r="3.5" /><path d="m9 10.5 7-7M13.5 6l2 2M12 7.5l1.5 1.5" /></>,
  scroll: <><path d="M6 3.5h9.5v11a2 2 0 0 1-2 2H5" /><path d="M6 3.5a2 2 0 0 0-2 2v1h2M5 16.5a2 2 0 0 0 2-2v-1H3v1a2 2 0 0 0 2 2zM9 7.5h4M9 10.5h4" /></>,
  signal: <><path d="M6.2 13.8a5.4 5.4 0 0 1 0-7.6M13.8 6.2a5.4 5.4 0 0 1 0 7.6M3.6 16.4a9 9 0 0 1 0-12.8M16.4 3.6a9 9 0 0 1 0 12.8" /><circle cx="10" cy="10" r="1.4" /></>,
  more: <path d="M5 10h.1M10 10h.1M15 10h.1" />,
  search: <><circle cx="9" cy="9" r="5.5" /><path d="m13 13 4 4" /></>,
  external: <><path d="M11 3.5h5.5V9M16.5 3.5 9 11" /><path d="M14 11.5V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className = '', strokeWidth = 1.6 }: { name: string; size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name] ?? P.info}
    </svg>
  );
}

/** SFMO's pixel bridge with the Σ underneath, as on sfmathopen.org. */
const BRIDGE = [[5,2,1,13],[7,2,1,13],[5,2,3,1],[5,6,3,1],[16,2,1,13],[18,2,1,13],[16,2,3,1],[16,6,3,1],[0,8,1,1],[1,7,1,1],[2,6,1,1],[3,5,1,1],[4,4,1,1],[19,4,1,1],[20,5,1,1],[21,6,1,1],[22,7,1,1],[23,8,1,1],[8,4,1,1],[9,6,1,1],[10,8,1,1],[11,9,1,1],[12,9,1,1],[13,8,1,1],[14,6,1,1],[15,4,1,1],[9,7,1,4],[14,7,1,4],[0,11,24,1]];
const SIGMA = [[9,12,5,1],[10,13,1,1],[11,14,1,1],[10,15,1,1],[9,16,5,1]];

export function BridgeMark({ scale = 1.25, color = 'currentColor', accent = 'var(--sub)' }: { scale?: number; color?: string; accent?: string }) {
  return (
    <svg className="brand-mark" width={24 * scale} height={18 * scale} viewBox="0 0 24 18" shapeRendering="crispEdges" aria-hidden="true">
      <g fill={color}>{BRIDGE.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}</g>
      <g fill={accent}>{SIGMA.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />)}</g>
    </svg>
  );
}
