import { useEffect } from 'react';
import { isPWA } from '@/utils/platform';

/** iPadOS Safari before 16.4 only has the prefixed names. */
interface FullscreenDocument {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
}
interface FullscreenElement {
  requestFullscreen?: () => Promise<void>;
  webkitRequestFullscreen?: () => void;
}

/** iPadOS counts these as a "user gesture" that may go full screen. */
const GESTURE_EVENTS = ['touchend', 'click'] as const;

/**
 * A wall opened in a Safari tab (so Safari's speech recognizer works, which it
 * doesn't in a Home Screen app) goes full screen on a touch, hiding the
 * address bar and toolbar. Fullscreen ends on a reload; the next touch brings
 * it back. A Home Screen app is full screen already.
 */
export function useWallFullscreen(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || isPWA()) return undefined;
    const root = document.documentElement as unknown as FullscreenElement;
    if (!root.requestFullscreen && !root.webkitRequestFullscreen) return undefined;
    const onGesture = () => {
      const doc = document as unknown as FullscreenDocument;
      if (doc.fullscreenElement ?? doc.webkitFullscreenElement) return;
      try {
        if (root.requestFullscreen) void root.requestFullscreen().catch(() => undefined);
        else root.webkitRequestFullscreen?.();
      } catch {
        // Refused (not a gesture it accepts); the next touch tries again.
      }
    };
    GESTURE_EVENTS.forEach(e => document.addEventListener(e, onGesture, { capture: true, passive: true }));
    return () => GESTURE_EVENTS.forEach(e => document.removeEventListener(e, onGesture, { capture: true }));
  }, [enabled]);
}
