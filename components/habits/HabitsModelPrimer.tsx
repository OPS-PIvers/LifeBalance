import React, { useState } from 'react';
import { Target, Flame, CalendarRange, Snowflake, Trophy, BookOpen } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { getMultiplier } from '@/utils/habitLogic';
import { FREEZE_MAX_TOKENS } from '@/utils/freezeBank';

interface HabitsModelPrimerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PrimerSection {
  icon: React.ReactNode;
  title: string;
  body: string;
}

// The multiplier figures in the copy come straight from getMultiplier, so the
// primer can never silently drift from the real scoring thresholds. The
// threshold DAYS/WEEKS named in the copy (3, 7, 2, 4) are asserted against
// getMultiplier's boundaries in HabitsModelPrimer.test.tsx.
const mult = (streak: number, period: 'daily' | 'weekly') =>
  `${getMultiplier(streak, true, period)}×`;

/**
 * A short explainer of the points/streak/freeze system — the Habits peer of
 * MoneyModelPrimer (components/budget/). Every claim here is verified against
 * utils/habitLogic.ts, utils/freezeBank.ts, and the Habit Tracking section of
 * CLAUDE.md:
 *   - threshold scoring pays once at targetCount; incremental pays every action
 *   - multipliers: daily 3-6 days 2x, 7+ 3x; weekly 2-3 weeks 2x, 4+ 3x;
 *     the multiplier includes the current completion; positive habits only
 *   - weekly habits streak in consecutive ISO weeks, not days
 *   - freeze bank: auto-applied at midnight/login to a missed day on a daily
 *     habit whose preserved streak is 3+; a frozen day bridges but earns zero;
 *     stock refills to FREEZE_MAX_TOKENS monthly
 * Copy is plain and warm, no em dashes, no marketing language.
 */
const SECTIONS: PrimerSection[] = [
  {
    icon: <Target size={16} />,
    title: 'Two ways a habit scores',
    body: 'Threshold habits pay out once, when you hit the target for the day, like finishing your 30 minutes of reading. Incremental habits score on every single action, which is how a bad habit can subtract points each time it happens.',
  },
  {
    icon: <Flame size={16} />,
    title: 'Streaks multiply your points',
    body: `Keep a daily habit going and it pays more: ${mult(3, 'daily')} points from day 3, ${mult(7, 'daily')} from day 7. The completion you just made counts toward its own streak, so day 3 itself already earns ${mult(3, 'daily')}. Multipliers only boost positive habits; a slip-up never costs extra.`,
  },
  {
    icon: <CalendarRange size={16} />,
    title: 'Weekly habits streak in weeks',
    body: `A weekly habit does not need seven perfect days. Its streak counts consecutive weeks, so completing it on any day of the week keeps the chain alive: ${mult(2, 'weekly')} from 2 weeks in a row, ${mult(4, 'weekly')} from 4.`,
  },
  {
    icon: <Snowflake size={16} />,
    title: 'The freeze bank has your back',
    body: `Miss a day on a daily habit with a streak of 3 or more, and at midnight or your next login a freeze token is spent to bridge the gap. The streak survives, but the frozen day itself earns no points. You hold up to ${FREEZE_MAX_TOKENS} tokens, restocked at the start of each month.`,
  },
  {
    icon: <Trophy size={16} />,
    title: 'Points add up to rewards',
    body: 'Everything you earn rolls into three running totals: today, this week, and all time. The total is what you spend in the Rewards store, so every streak day is progress toward something real.',
  },
];

export const HabitsModelPrimer: React.FC<HabitsModelPrimerProps> = ({ isOpen, onClose }) => (
  <Drawer isOpen={isOpen} onClose={onClose} title="How points & streaks work">
    <p className="mb-5 text-sm leading-relaxed text-brand-600 dark:text-brand-300">
      Points, streaks, multipliers, freezes. Here is the whole game in under a minute.
    </p>

    <ol className="space-y-5">
      {SECTIONS.map(section => (
        <li key={section.title} className="flex gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-card border border-brand-200 bg-brand-100 text-warm-600 dark:border-brand-700 dark:bg-brand-700/50 dark:text-warm-300">
            {section.icon}
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold tracking-tight text-brand-900 dark:text-brand-50">
              {section.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-brand-600 dark:text-brand-300">
              {section.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  </Drawer>
);

/**
 * Self-contained quiet entry point: a text link (same disclosure idiom as
 * SafeToSpendDetail's money-primer link, warm-toned for the gamification
 * side) that owns the primer's open state and renders the drawer itself, so
 * host surfaces (Habits Track tab, PointsBreakdownModal) wire it with a
 * single line and pages/Habits.tsx stays a minimal diff.
 */
export const HabitsModelPrimerLink: React.FC<{ className?: string }> = ({ className }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // 16px text-line hit area is well under the 44px floor; the house
        // extender pattern (Button's `sm`/`md` sizes) grows the tap target
        // vertically without inflating the visible link.
        className="relative inline-flex items-center gap-1.5 text-xs font-semibold text-warm-600 hover:text-warm-700 dark:text-warm-300 dark:hover:text-warm-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-xs before:absolute before:inset-x-0 before:-inset-y-4 before:content-['']"
      >
        <BookOpen size={13} aria-hidden="true" />
        How points &amp; streaks work
      </button>
      <HabitsModelPrimer isOpen={open} onClose={() => setOpen(false)} />
    </div>
  );
};

export default HabitsModelPrimer;
