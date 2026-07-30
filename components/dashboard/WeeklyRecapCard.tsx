import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X, Lock, ChevronRight, Sparkles } from 'lucide-react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { consumeRecapParam } from '@/utils/recapParam';
import { track } from '@/services/analytics';
import { roundMoney } from '@/utils/money';
import { isoWeekStartDate } from '@/utils/dateHelpers';
import { cn } from '@/utils/cn';
import { Section } from '@/components/ui/Section';
import { WeeklyRecapDrawer } from '@/components/dashboard/WeeklyRecapDrawer';
import { weeklyRecapCardVisible, weeklyRecapDismissKey } from '@/components/dashboard/recapVisibility';
import type { WeeklyRecap } from '@/types/schema';

/**
 * WeeklyRecapCard — Dashboard surface for the server-generated weekly recap
 * (Plan 02, `households/{id}/recaps/{isoWeek}`).
 *
 * Shows the LATEST recap for a few days after it lands (Monday → Thursday),
 * dismissible per ISO week (localStorage). Headline numbers render for every
 * plan; the AI narrative is blurred behind a small upsell row when the recap
 * was generated for a free household (`premium: false`). Tapping the card —
 * or arriving via the `?recap=<isoWeek>` push deep link — opens the full
 * detail drawer. The drawer mounts even when the card itself is hidden
 * (dismissed/stale) so a late push open still works.
 */

// Freshness window + dismissal logic live in recapVisibility.ts, shared with
// RecapSlot (which asks "would this card show?" to arbitrate the shared slot).
const shouldShowCard = weeklyRecapCardVisible;

const persistDismiss = (isoWeek: string): void => {
  try {
    window.localStorage.setItem(weeklyRecapDismissKey(isoWeek), '1');
  } catch {
    // Best-effort — the in-session state still hides the card.
  }
};

interface WeeklyRecapCardProps {
  /**
   * Render only the (always-mounted) detail drawer, not the card — used by
   * RecapSlot when the monthly money recap won the shared Dashboard slot, so
   * the `?recap=` push deep link keeps working while the card stays hidden.
   */
  drawerOnly?: boolean;
}

export const WeeklyRecapCard: React.FC<WeeklyRecapCardProps> = ({ drawerOnly = false }) => {
  const { recaps } = useHouseholdCore();
  const fmt = useFormatCurrency();

  const latest: WeeklyRecap | undefined = recaps[0];

  // Dismissal — per-isoWeek session state; persistence lives in localStorage
  // (read via shouldShowCard so a re-mount stays hidden).
  const [dismissedWeek, setDismissedWeek] = useState<string | null>(null);

  // Detail drawer target. `drawerWeek` is set by a card tap; `pushWeek` by the
  // `?recap=<isoWeek>` deep link (held until the recaps listener delivers,
  // since the push open usually beats the first snapshot).
  const [drawerWeek, setDrawerWeek] = useState<string | null>(null);
  const [pushWeek, setPushWeek] = useState<string | null>(null);

  useEffect(() => {
    // Consume the deep-link param once on mount. The setState is deferred to a
    // macrotask (external-input subscription style) rather than called
    // synchronously in the effect body; deliberately no cleanup — under
    // StrictMode's double-effect the second run sees the already-stripped URL
    // and no-ops, so a cleanup would cancel the only real timer.
    const week = consumeRecapParam();
    if (!week) return;
    window.setTimeout(() => {
      track('recap_push_opened');
      setPushWeek(week);
    }, 0);
  }, []);

  // Resolve the push target once recaps arrive: the requested week when it's
  // in the live window, else the latest.
  const pushRecap = useMemo<WeeklyRecap | null>(() => {
    if (!pushWeek) return null;
    return recaps.find(r => r.isoWeek === pushWeek) ?? recaps[0] ?? null;
  }, [pushWeek, recaps]);

  // Fire `recap_viewed` once per push-opened week. A ref (not state) — nothing
  // renders from it, and it dedupes StrictMode's doubled effect runs.
  const trackedPushWeekRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pushRecap) return;
    if (trackedPushWeekRef.current === pushRecap.isoWeek) return;
    trackedPushWeekRef.current = pushRecap.isoWeek;
    track('recap_viewed', { isoWeek: pushRecap.isoWeek, source: 'push' });
  }, [pushRecap]);

  const tappedRecap = useMemo<WeeklyRecap | null>(
    () => (drawerWeek ? (recaps.find(r => r.isoWeek === drawerWeek) ?? null) : null),
    [drawerWeek, recaps]
  );
  const activeRecap = tappedRecap ?? pushRecap;

  const closeDrawer = () => {
    setDrawerWeek(null);
    setPushWeek(null);
  };

  const drawer = (
    <WeeklyRecapDrawer recap={activeRecap} isOpen={activeRecap !== null} onClose={closeDrawer} />
  );

  // --- Card visibility -----------------------------------------------------
  if (drawerOnly || !latest) return drawer;
  if (dismissedWeek === latest.isoWeek || !shouldShowCard(latest)) {
    return drawer;
  }

  const diff = roundMoney(latest.totalSpend - latest.priorWeekSpend);
  const spentLess = diff < 0;

  const openDrawer = () => {
    setDrawerWeek(latest.isoWeek);
    track('recap_viewed', { isoWeek: latest.isoWeek, source: 'card' });
  };

  const dismiss = () => {
    persistDismiss(latest.isoWeek);
    setDismissedWeek(latest.isoWeek);
  };

  // Visible title states WHICH week this is ("Week of Jul 20") so it can never
  // be mistaken for the Dashboard's in-progress "This week (so far)" figure —
  // falls back to the generic title only if isoWeek is somehow malformed.
  const weekStart = isoWeekStartDate(latest.isoWeek);
  const weekTitle = weekStart ? `Week of ${format(weekStart, 'MMM d')}` : 'Your week in review';

  return (
    <>
      <Section
        title={weekTitle}
        action={
          <button
            onClick={dismiss}
            className="flex items-center justify-center min-h-11 min-w-11 -m-3 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300 rounded-full"
            aria-label="Dismiss weekly recap"
          >
            <X size={16} />
          </button>
        }
      >
        <button
          onClick={openDrawer}
          className="w-full text-left surface-section p-4 space-y-3 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.99] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          aria-label={`Open weekly recap for ${latest.isoWeek}`}
        >
          {/* Headline numbers — money in directional tokens, habits in amber.
              The delta lives in its own line below (not inline with "spent")
              so a 5-figure amount + a 3-digit habit count never fight for the
              same row at 375px — that's what orphaned "week" onto a second
              line and threw off the row's baseline alignment. The row itself
              wraps (matching MoneyPulseWidget's convention) rather than
              forcing both halves to nowrap on one line: a two-char currency
              prefix (CAD renders "CA$") or an unconverted 5-6 digit JPY
              amount can outgrow the budget a 1-character "$" assumed, and
              without flex-wrap that ran the habit stat off the card instead
              of dropping it to its own line. */}
          <div>
            <div className="flex items-baseline justify-between gap-x-3 gap-y-1 flex-wrap">
              <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                <span className="stat-num text-2xl font-bold text-accent-700 dark:text-accent-300">
                  {fmt(latest.totalSpend, { decimals: 0 })}
                </span>
                <span className="text-xs font-medium text-brand-500 dark:text-brand-400">
                  spent
                </span>
              </div>
              <span className="flex items-center gap-1 text-xs font-semibold text-warm-700 dark:text-warm-300 whitespace-nowrap">
                <Sparkles size={12} aria-hidden="true" />
                {latest.habitCompletions} habit{latest.habitCompletions === 1 ? '' : 's'} done
              </span>
            </div>
            {latest.priorWeekSpend > 0 && diff !== 0 && (
              <div className="mt-1">
                <span
                  className={cn(
                    'text-xs font-semibold',
                    spentLess ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'
                  )}
                >
                  {spentLess ? '↓' : '↑'} {fmt(Math.abs(diff), { decimals: 0 })} vs last week
                </span>
              </div>
            )}
          </div>

          {/* Narrative snippet — blurred + upsell when the recap is free-tier */}
          {latest.premium ? (
            <p className="text-sm text-brand-600 dark:text-brand-300 line-clamp-2">
              {latest.narrative}
            </p>
          ) : (
            <div>
              <p
                className="text-sm text-brand-600 dark:text-brand-300 line-clamp-2 blur-sm select-none"
                aria-hidden="true"
              >
                {latest.narrative || 'Your personalized weekly summary is ready to read.'}
              </p>
              <span className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-warm-700 dark:text-warm-300">
                <Lock size={12} aria-hidden="true" />
                Unlock your personal recap with Premium
              </span>
            </div>
          )}

          <span className="flex items-center gap-0.5 text-xs font-semibold text-accent-700 dark:text-accent-300">
            See the full recap
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        </button>
      </Section>
      {drawer}
    </>
  );
};
