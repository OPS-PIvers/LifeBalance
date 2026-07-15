import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Lock, ChevronRight, Wallet } from 'lucide-react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { consumeMoneyRecapParam } from '@/utils/moneyRecapParam';
import { track } from '@/services/analytics';
import { roundMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import { formatMonthLabel } from '@/utils/monthLabel';
import { Section } from '@/components/ui/Section';
import { MoneyRecapDrawer } from '@/components/dashboard/MoneyRecapDrawer';
import type { MonthlyMoneyRecap } from '@/types/schema';

/**
 * MoneyRecapCard — Dashboard surface for the server-generated monthly money
 * recap (F-MONEY-06, `households/{id}/moneyRecaps/{month}`).
 *
 * Shows the LATEST recap for a few days after it lands (early in the month),
 * dismissible per calendar month (localStorage). Headline numbers render for
 * every plan; the AI narrative is blurred behind a small upsell row when the
 * recap was generated for a free household (`premium: false`). Tapping the card
 * — or arriving via the `?moneyrecap=<month>` push deep link — opens the full
 * detail drawer. The drawer mounts even when the card itself is hidden
 * (dismissed/stale) so a late push open still works. Structurally mirrors
 * WeeklyRecapCard.
 */

/** How long after generation the card stays on the Dashboard. */
const FRESHNESS_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

const dismissKey = (month: string) => `lb_money_recap_dismissed_${month}`;

/**
 * Whether the latest recap should render as a card right now: fresh (within the
 * window, with a sane timestamp) and not dismissed for that month. Module helper
 * (not inline) so the impure reads — clock + localStorage — stay out of render.
 */
function shouldShowCard(recap: MonthlyMoneyRecap): boolean {
  const ageMs = Date.now() - new Date(recap.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > FRESHNESS_WINDOW_MS) return false;
  try {
    return window.localStorage.getItem(dismissKey(recap.month)) !== '1';
  } catch {
    return true;
  }
}

const persistDismiss = (month: string): void => {
  try {
    window.localStorage.setItem(dismissKey(month), '1');
  } catch {
    // Best-effort — the in-session state still hides the card.
  }
};

export const MoneyRecapCard: React.FC = () => {
  const { moneyRecaps } = useHouseholdCore();
  const fmt = useFormatCurrency();

  const latest: MonthlyMoneyRecap | undefined = moneyRecaps[0];

  // Dismissal — per-month session state; persistence lives in localStorage
  // (read via shouldShowCard so a re-mount stays hidden).
  const [dismissedMonth, setDismissedMonth] = useState<string | null>(null);

  // Detail drawer target. `drawerMonth` is set by a card tap; `pushMonth` by the
  // `?moneyrecap=<month>` deep link (held until the listener delivers, since the
  // push open usually beats the first snapshot).
  const [drawerMonth, setDrawerMonth] = useState<string | null>(null);
  const [pushMonth, setPushMonth] = useState<string | null>(null);

  useEffect(() => {
    // Consume the deep-link param once on mount. The setState is deferred to a
    // macrotask rather than called synchronously in the effect body; under
    // StrictMode's double-effect the second run sees the already-stripped URL
    // and no-ops, so a cleanup would cancel the only real timer.
    const month = consumeMoneyRecapParam();
    if (!month) return;
    window.setTimeout(() => {
      track('money_recap_push_opened');
      setPushMonth(month);
    }, 0);
  }, []);

  // Resolve the push target once recaps arrive: the requested month when it's
  // in the live window, else the latest.
  const pushRecap = useMemo<MonthlyMoneyRecap | null>(() => {
    if (!pushMonth) return null;
    return moneyRecaps.find(r => r.month === pushMonth) ?? moneyRecaps[0] ?? null;
  }, [pushMonth, moneyRecaps]);

  // Fire `money_recap_viewed` once per push-opened month. A ref (not state) —
  // nothing renders from it, and it dedupes StrictMode's doubled effect runs.
  const trackedPushMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pushRecap) return;
    if (trackedPushMonthRef.current === pushRecap.month) return;
    trackedPushMonthRef.current = pushRecap.month;
    track('money_recap_viewed', { month: pushRecap.month, source: 'push' });
  }, [pushRecap]);

  const tappedRecap = useMemo<MonthlyMoneyRecap | null>(
    () => (drawerMonth ? (moneyRecaps.find(r => r.month === drawerMonth) ?? null) : null),
    [drawerMonth, moneyRecaps]
  );
  const activeRecap = tappedRecap ?? pushRecap;

  const closeDrawer = () => {
    setDrawerMonth(null);
    setPushMonth(null);
  };

  const drawer = (
    <MoneyRecapDrawer recap={activeRecap} isOpen={activeRecap !== null} onClose={closeDrawer} />
  );

  // --- Card visibility -----------------------------------------------------
  if (!latest) return drawer;
  if (dismissedMonth === latest.month || !shouldShowCard(latest)) {
    return drawer;
  }

  const diff = roundMoney(latest.totalSpend - latest.priorMonthSpend);
  const spentLess = diff < 0;

  const openDrawer = () => {
    setDrawerMonth(latest.month);
    track('money_recap_viewed', { month: latest.month, source: 'card' });
  };

  const dismiss = () => {
    persistDismiss(latest.month);
    setDismissedMonth(latest.month);
  };

  return (
    <>
      <Section
        title="Your month in money"
        action={
          <button
            onClick={dismiss}
            className="p-1 min-h-6 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300"
            aria-label="Dismiss monthly money recap"
          >
            <X size={16} />
          </button>
        }
      >
        <button
          onClick={openDrawer}
          className="w-full text-left surface-section p-4 space-y-3 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.99] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
          aria-label={`Open money recap for ${formatMonthLabel(latest.month)}`}
        >
          {/* Headline numbers */}
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <span className="stat-num text-2xl font-bold text-accent-700 dark:text-accent-300">
                {fmt(latest.totalSpend, { decimals: 0 })}
              </span>
              <span className="ml-1.5 text-xs font-medium text-brand-500 dark:text-brand-400">
                spent in {formatMonthLabel(latest.month)}
              </span>
              {latest.priorMonthSpend > 0 && diff !== 0 && (
                <span
                  className={cn(
                    'ml-2 text-xs font-semibold',
                    spentLess ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'
                  )}
                >
                  {spentLess ? '↓' : '↑'} {fmt(Math.abs(diff), { decimals: 0 })} vs last month
                </span>
              )}
            </div>
            <span className="flex items-center gap-1 text-xs font-semibold text-warm-700 dark:text-warm-300 shrink-0">
              <Wallet size={12} aria-hidden="true" />
              {fmt(latest.totalIncome, { decimals: 0 })} in
            </span>
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
                {latest.narrative || 'Your personalized monthly money summary is ready to read.'}
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
