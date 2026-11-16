/**
 * What the browser can tell proctors: whether the test is in full screen and
 * whether the tab is in front. Sent with every request as `hb`.
 */
import { useEffect, useState } from 'react';

type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

export function fullscreenSupported(): boolean {
  const el = document.documentElement as FsEl;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}

export async function enterFullscreen(): Promise<boolean> {
  const el = document.documentElement as FsEl;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    return isFullscreen();
  } catch {
    return false;
  }
}

export function exitFullscreen() {
  const d = document as FsDoc;
  try {
    if (d.exitFullscreen && d.fullscreenElement) d.exitFullscreen();
    else if (d.webkitExitFullscreen && d.webkitFullscreenElement) d.webkitExitFullscreen();
  } catch {
    /* already out */
  }
}

export function useFullscreen(): boolean {
  const [fs, setFs] = useState(() => (typeof document !== 'undefined' ? isFullscreen() : false));
  useEffect(() => {
    const on = () => setFs(isFullscreen());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);
  return fs;
}

/** The live state a round page reports to proctors. */
export const heartbeat = (round: string) => ({ round, fs: isFullscreen(), vis: !document.hidden });
