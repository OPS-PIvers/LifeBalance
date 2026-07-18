import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { hasSeenSubViewHint, markSubViewHintSeen } from '@/utils/subViewHint';

export interface SubViewHintProps {
  /**
   * True while any tab sub-view menu is open. Opening a menu proves the
   * lesson landed, so the hint dismisses itself (and latches) immediately.
   */
  menuOpened: boolean;
  className?: string;
}

// SubViewHint: one-time coach hint for the tab-popover sub-view nav
// (TabSubViewMenu). Multi-view tabs only signal "there's more here" with a
// small caret, so the very first visit to a page that has them gets this
// dismissible one-liner under the tab bar. It disappears — and never returns,
// on any page (one shared localStorage latch, utils/subViewHint.ts) — when
// the user opens any tab menu, taps the ×, or navigates away.
export const SubViewHint: React.FC<SubViewHintProps> = ({ menuOpened, className }) => {
  const [visible, setVisible] = React.useState(() => !hasSeenSubViewHint());

  // Derived dismissal during render (React's adjust-state-while-rendering
  // pattern — no effect, so no set-state-in-effect churn): the moment a tab
  // menu opens, the hint has done its job.
  if (visible && menuOpened) {
    setVisible(false);
  }

  // ANY way the hint stops showing sets the one-time latch: the × and the
  // menu-open dismissal flip `visible` (latched by the effect body on the
  // re-run), and navigating away unmounts while visible (latched by the
  // cleanup). Idempotent, so the already-seen re-mark on entry is harmless.
  React.useEffect(() => {
    if (!visible) {
      markSubViewHintSeen();
      return;
    }
    return () => markSubViewHintSeen();
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-2 rounded-card border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 px-3 py-2',
        'animate-in fade-in slide-in-from-top-1 duration-(--duration-base) ease-(--ease-standard)',
        className
      )}
    >
      <p className="flex-1 text-xs leading-snug text-brand-600 dark:text-brand-300">
        Tabs with{' '}
        <ChevronDown size={12} aria-hidden="true" className="inline -mt-0.5" />
        <span className="sr-only">a caret</span> hold more views — tap one to choose.
      </p>
      <button
        type="button"
        onClick={() => setVisible(false)}
        aria-label="Dismiss hint"
        className="shrink-0 -m-1 p-1.5 rounded-btn text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
};
