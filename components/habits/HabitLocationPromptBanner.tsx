import React, { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { useHabitLocationPrompt } from '@/hooks/useHabitLocationPrompt';

/**
 * Habit Automations (PRD #1065) — the foreground geo confirm-prompt banner.
 * "You're at <location> — log <habit>?" NEVER auto-logs; confirming fires the
 * habit exactly like one manual tap (`useHabitLocationPrompt`'s `confirm`).
 * Fixed just above the BottomNav, mirroring `OfflineBanner`'s placement so the
 * two never fight for the same slot.
 */
export const HabitLocationPromptBanner: React.FC = () => {
  const { current, confirm, dismiss } = useHabitLocationPrompt();
  const [isConfirming, setIsConfirming] = useState(false);

  if (!current) return null;

  const handleConfirm = async () => {
    setIsConfirming(true);
    try {
      await confirm();
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-0 right-0 z-dropdown bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] px-3 pb-2"
    >
      <div className="flex items-center gap-3 rounded-card border border-warm-300 dark:border-warm-800/60 bg-warm-50 dark:bg-warm-900/90 shadow-raised px-4 py-3">
        <MapPin size={18} className="text-warm-600 dark:text-warm-300 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-brand-800 dark:text-brand-100">
          You&rsquo;re at <span className="font-semibold">{current.locationName}</span> — log{' '}
          <span className="font-semibold">{current.habitTitle}</span>?
        </p>
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={isConfirming}
          className="shrink-0 rounded-btn bg-warm-500 text-white text-sm font-semibold px-3 py-2 hover:bg-warm-600 active:scale-[0.98] transition-all disabled:opacity-60 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
        >
          Log it
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 p-1.5 text-brand-400 dark:text-brand-450 hover:text-brand-700 dark:hover:text-brand-200 rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default HabitLocationPromptBanner;
