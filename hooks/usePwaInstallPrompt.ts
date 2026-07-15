import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/services/analytics';

/**
 * usePwaInstallPrompt — captures the Chromium `beforeinstallprompt` event so
 * the app can show its own "Add to Home Screen" banner instead of relying on
 * the browser's easy-to-miss/dismiss default UI.
 *
 * How it knows the user has already installed (owner question):
 * - `beforeinstallprompt` is captured (Chromium only) and `preventDefault()`d
 *   so the native mini-infobar never shows; the event is stashed for later
 *   `.prompt()` — Chromium only fires it once per navigation/session, so it
 *   is captured eagerly on mount rather than re-queried on demand.
 * - The `appinstalled` event fires once the user completes the native
 *   install flow (whether triggered by our banner or the browser's own UI);
 *   we persist that in localStorage so the banner never shows again on this
 *   device, and fire `pwa_installed`.
 * - Already-installed launches (a prior install, a different entry point, or
 *   a browser that skips `beforeinstallprompt` entirely) are detected via
 *   `matchMedia('(display-mode: standalone)')` plus the iOS-only
 *   `navigator.standalone` — both are checked on mount so the banner never
 *   renders inside an already-installed app shell.
 * - iOS Safari never fires `beforeinstallprompt` at all, so `canInstall`
 *   stays false there; callers that want the iOS "Share → Add to Home
 *   Screen" instructional variant should check `isIosSafari` instead.
 *
 * Dismissal is persisted separately by the banner component (per the
 * `WeeklyRecapCard`/localStorage dismiss pattern) — this hook only tracks
 * installability and installed state, not UI visibility.
 */

const INSTALLED_FLAG = 'lb_pwa_installed';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithIosFlag = window.navigator as Navigator & { standalone?: boolean };
  return (
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    navigatorWithIosFlag.standalone === true
  );
}

function readInstalledFlag(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_FLAG) === '1';
  } catch {
    return false;
  }
}

function persistInstalledFlag(): void {
  try {
    window.localStorage.setItem(INSTALLED_FLAG, '1');
  } catch {
    // Best-effort — the in-session state still reflects installed.
  }
}

/** True on iOS Safari, which never fires `beforeinstallprompt`. */
export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari;
}

export interface UsePwaInstallPromptResult {
  /** True once a Chromium `beforeinstallprompt` event has been captured and not yet consumed. */
  canInstall: boolean;
  /** True if the app is already running in an installed/standalone shell. */
  isInstalled: boolean;
  /** Triggers the native install UI; resolves once the user has responded. */
  promptInstall: () => Promise<void>;
}

export function usePwaInstallPrompt(): UsePwaInstallPromptResult {
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneDisplayMode() || readInstalledFlag());

  useEffect(() => {
    if (typeof window === 'undefined' || isInstalled) return;

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const handleAppInstalled = () => {
      deferredPromptRef.current = null;
      persistInstalledFlag();
      setCanInstall(false);
      setIsInstalled(true);
      track('pwa_installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isInstalled]);

  const promptInstall = useCallback(async () => {
    const deferredPrompt = deferredPromptRef.current;
    if (!deferredPrompt) return;
    track('pwa_install_prompted');
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPromptRef.current = null;
    setCanInstall(false);
    track(outcome === 'accepted' ? 'pwa_install_accepted' : 'pwa_install_dismissed');
  }, []);

  return { canInstall, isInstalled, promptInstall };
}
