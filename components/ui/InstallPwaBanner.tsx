import React, { useEffect, useState } from 'react';
import { X, Share, PlusSquare, Download } from 'lucide-react';
import { usePwaInstallPrompt, isIosSafari } from '@/hooks/usePwaInstallPrompt';
import { recordSessionAndGetCount, hasMetInstallEngagementGate } from '@/utils/pwaInstallEngagement';
import { Button } from '@/components/ui/Button';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';

/**
 * InstallPwaBanner — LifeBalance's own "Add to Home Screen" prompt (F-PLAT-01).
 *
 * Renders one of two variants once the engagement gate is met
 * (`hasMetInstallEngagementGate`): the Chromium install banner (calls
 * `promptInstall()`, backed by the captured `beforeinstallprompt` event), or
 * a one-time iOS Safari instructional variant (no native prompt exists there,
 * so we explain the manual Share → Add to Home Screen steps).
 *
 * Dismissal is remembered permanently per device (localStorage), same
 * dismiss-and-never-nag pattern as `WeeklyRecapCard`.
 */

const DISMISSED_KEY = 'lb_pwa_install_dismissed';
const IOS_SHOWN_KEY = 'lb_pwa_install_ios_shown';

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function persistDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    // Best-effort — in-session state still hides the banner.
  }
}

export const InstallPwaBanner: React.FC = () => {
  const { canInstall, isInstalled, promptInstall } = usePwaInstallPrompt();
  // Lazy initializer (not an effect): the session-count bump + gate check are
  // one-time, idempotent-per-tab localStorage reads/writes, same pattern as
  // the `dismissed`/`iosDismissed` lazy reads below — doing this in an effect
  // would need a synchronous setState-in-effect (banned; cascading render).
  const [engaged] = useState(() => hasMetInstallEngagementGate(recordSessionAndGetCount()));
  const [dismissed, setDismissed] = useState(() => readDismissed(DISMISSED_KEY));
  const iosEligible = isIosSafari();
  const [iosDismissed, setIosDismissed] = useState(() => readDismissed(IOS_SHOWN_KEY));

  const showChromiumVariant = !isInstalled && engaged && canInstall && !dismissed;
  const showIosVariant =
    !isInstalled && engaged && !showChromiumVariant && iosEligible && !iosDismissed;

  // Fire once when the iOS instructional variant first becomes visible. All
  // hooks stay unconditional (above any early return) per rules-of-hooks.
  useEffect(() => {
    if (showIosVariant) track('pwa_install_ios_instructions_shown');
  }, [showIosVariant]);

  if (!showChromiumVariant && !showIosVariant) return null;

  const handleDismissChromium = () => {
    setDismissed(true);
    persistDismissed(DISMISSED_KEY);
  };

  const handleDismissIos = () => {
    setIosDismissed(true);
    persistDismissed(IOS_SHOWN_KEY);
  };

  const handleInstallClick = () => {
    void promptInstall();
  };

  return (
    <div
      role="region"
      aria-label="Install LifeBalance"
      className={cn(
        'fixed left-0 right-0 z-dropdown',
        'bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]',
        'mx-3 mb-2 rounded-xl border border-brand-200 dark:border-brand-700',
        'bg-white dark:bg-brand-800 shadow-lg',
        'px-4 py-3 flex items-center gap-3',
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300">
        <Download size={18} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-900 dark:text-brand-50">
          Install LifeBalance
        </p>
        {showChromiumVariant ? (
          <p className="text-xs text-brand-600 dark:text-brand-300">
            Add it to your home screen for quicker access.
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-brand-600 dark:text-brand-300">
            Tap <Share size={12} aria-hidden="true" className="inline shrink-0" />, then{' '}
            <PlusSquare size={12} aria-hidden="true" className="inline shrink-0" /> Add to Home
            Screen.
          </p>
        )}
      </div>
      {showChromiumVariant && (
        <Button size="sm" variant="primary" onClick={handleInstallClick}>
          Install
        </Button>
      )}
      <button
        type="button"
        onClick={showChromiumVariant ? handleDismissChromium : handleDismissIos}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-md p-1.5 text-brand-400 hover:bg-brand-100 hover:text-brand-600 dark:hover:bg-brand-700 dark:hover:text-brand-200"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
};
