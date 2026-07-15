import { useEffect } from 'react';

/**
 * Web App Badging API (F-NOTIF-07): mirrors a numeric count onto the
 * installed-PWA home-screen icon via `navigator.setAppBadge`/`clearAppBadge`.
 *
 * Feature-detected — Chromium-based browsers (desktop/Android/installed PWA)
 * support it; iOS Safari support is spotty and simply no-ops. Never throws:
 * both calls are wrapped, since some browsers implement the method but throw
 * (e.g. when not installed/standalone).
 *
 * Single source of truth for the count is the caller — this hook does not
 * compute anything, it only mirrors whatever count it's given onto the icon.
 */
export const useAppBadge = (count: number): void => {
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;

    const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

    if (safeCount > 0) {
      navigator.setAppBadge(safeCount).catch(() => {
        /* Badging API present but call failed (e.g. not installed) — no-op. */
      });
    } else if ('clearAppBadge' in navigator) {
      navigator.clearAppBadge().catch(() => {
        /* no-op */
      });
    }
  }, [count]);
};
