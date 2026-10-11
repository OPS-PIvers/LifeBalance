import { useSyncExternalStore } from 'react';
import { isPWA } from '@/utils/platform';

/** iPadOS Safari before 16.4 only has the prefixed names. */
interface FullscreenDocument {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => void;
}
interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

/**
 * Full screen for a wall in a Safari tab (Safari's speech recognizer works
 * there, not in a Home Screen app), so the address bar and toolbar hide.
 *
 * Only ever on a tap of the display menu's own button, and only on the wall's
 * box, never the page: going full screen on the page's first touch turned a
 * to-do tap into Safari's full-screen transition, after which iPadOS drew the
 * wall four times over and took no more touches until a reload.
 *
 * iPadOS leaves full screen on any quick one-finger swipe down, wherever it
 * lands (WebKit's own gesture, which a page can't cancel), so flicking a list
 * back up leaves it. The wall's Full screen chip makes coming back one tap.
 */
export function canFullscreen(): boolean {
  if (typeof Element === 'undefined' || isPWA()) return false;
  const f = Element.prototype as unknown as FullscreenElement;
  return typeof f.requestFullscreen === 'function' || typeof f.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  const doc = document as unknown as FullscreenDocument;
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Enters full screen on `el`, or leaves it. Must run inside the tap's handler. */
export function toggleFullscreen(el: Element | null): void {
  const doc = document as unknown as FullscreenDocument;
  try {
    if (isFullscreen()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
      else doc.webkitExitFullscreen?.();
      return;
    }
    const f = el as unknown as FullscreenElement | null;
    if (f?.requestFullscreen) void f.requestFullscreen().catch(() => undefined);
    else f?.webkitRequestFullscreen?.();
  } catch {
    // Refused; the wall carries on with the address bar showing.
  }
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  return () => {
    document.removeEventListener('fullscreenchange', onChange);
    document.removeEventListener('webkitfullscreenchange', onChange);
  };
}

/** Whether the wall is full screen right now, kept current as Safari enters and leaves it. */
export function useIsFullscreen(): boolean {
  return useSyncExternalStore(subscribe, isFullscreen, () => false);
}
