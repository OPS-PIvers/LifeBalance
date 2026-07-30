import React, { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Lock, Flame, TrendingDown, TrendingUp, Share2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import Eyebrow from '@/components/ui/Eyebrow';
import { Button } from '@/components/ui/Button';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { roundMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import { DEFAULT_CURRENCY } from '@/utils/formatCurrency';
import { shareRecapCard } from '@/utils/recapShareCard';
import { track } from '@/services/analytics';
import { RecapDeck } from '@/components/dashboard/RecapDeck';
import { buildRecapDeck, hasCeremonyData } from '@/utils/recapDeck';
import { resolveCeremonyTone } from '@/utils/freezeSettings';
import type { WeeklyRecap } from '@/types/schema';

/**
 * WeeklyRecapDrawer — bottom-sheet detail view of one weekly recap (Plan 02),
 * and, since the ceremony landed (per-member points, stage 5), the host of the
 * weekly story deck.
 *
 * 🛡️ ONE ARTIFACT. The ceremony EVOLVED this drawer rather than adding a second
 * surface: same recap document, same card entry point, same `/?recap=<isoWeek>`
 * push deep link, same `recap.premium` gate on the narrative. A recap that
 * carries the per-member ceremony fields opens as the 4-card deck with the
 * money/habit sections tucked into a "Week details" disclosure beneath it; a
 * recap WITHOUT them (every one written before stage 5) renders exactly the
 * pre-deck layout it always did. `hasCeremonyData` is the only gate.
 *
 * Statically imported by the Dashboard-only WeeklyRecapCard — the Dashboard
 * page is itself lazy-loaded, so the Drawer/framer-motion dependency stays off
 * the boot bundle (same rationale as other page-mounted drawers; only
 * always-mounted shells must use LazyMount).
 */

interface WeeklyRecapDrawerProps {
  recap: WeeklyRecap | null;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Neutral used for the chart's "household" (unattributed) series — a hex, not
 * a class, because the chart's segments are inline `backgroundColor`s like
 * every other member-colored surface. Reads as `brand-300` in both themes.
 */
const UNATTRIBUTED_COLOR = '#a19b8c';

const SectionBlock: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <Eyebrow className="mb-2">{label}</Eyebrow>
    {children}
  </div>
);

export const WeeklyRecapDrawer: React.FC<WeeklyRecapDrawerProps> = ({ recap, isOpen, onClose }) => {
  const fmt = useFormatCurrency();
  const { householdSettings, members, currentUser, recaps } = useHouseholdCore();
  const [isSharing, setIsSharing] = useState(false);

  // The deck is built only when the recap actually carries the ceremony
  // fields; `null` here IS the graceful degrade to the pre-deck layout.
  const deck = useMemo(() => {
    if (!recap || !hasCeremonyData(recap)) return null;
    return buildRecapDeck({
      recap,
      recaps,
      members,
      viewerId: currentUser?.uid,
      tone: resolveCeremonyTone(householdSettings),
      unattributedColor: UNATTRIBUTED_COLOR,
    });
  }, [recap, recaps, members, currentUser?.uid, householdSettings]);

  const handleDeckComplete = useCallback(() => {
    if (!recap) return;
    track('recap_deck_completed', { isoWeek: recap.isoWeek, tone: deck?.tone ?? 'household_first' });
  }, [recap, deck?.tone]);

  const handleShare = useCallback(async () => {
    if (!recap) return;
    setIsSharing(true);
    try {
      const currency = householdSettings?.currency || DEFAULT_CURRENCY;
      const result = await shareRecapCard(recap, currency);
      track('recap_shared', { isoWeek: recap.isoWeek, method: result });
      if (result === 'downloaded') {
        toast.success('Recap card downloaded — share it from your photos.');
      }
    } catch (err) {
      // AbortError fires when the user cancels the native share sheet — not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast.error("Couldn't create your recap card. Try again in a bit.");
    } finally {
      setIsSharing(false);
    }
  }, [recap, householdSettings]);

  if (!recap) return null;

  const diff = roundMoney(recap.totalSpend - recap.priorWeekSpend);
  const spentLess = diff < 0;
  const DiffIcon = spentLess ? TrendingDown : TrendingUp;

  // The money/habit sections. In deck mode they move BELOW the deck into a
  // collapsed "Week details" disclosure — the ceremony must not cost anyone the
  // spend, bills and streak detail this drawer has always carried.
  const detailSections = (
    <>
      {/* Spend vs prior week */}
        <SectionBlock label="Spending">
          <div className="flex items-baseline gap-3">
            <span className="stat-num text-3xl font-bold text-accent-700 dark:text-accent-300">
              {fmt(recap.totalSpend, { decimals: 0 })}
            </span>
            {recap.priorWeekSpend > 0 && diff !== 0 && (
              <span
                className={cn(
                  'flex items-center gap-1 text-sm font-semibold',
                  spentLess ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'
                )}
              >
                <DiffIcon size={14} aria-hidden="true" />
                {fmt(Math.abs(diff), { decimals: 0 })} {spentLess ? 'less' : 'more'} than last week
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-brand-500 dark:text-brand-400">
            Last week: {fmt(recap.priorWeekSpend, { decimals: 0 })}
          </p>
        </SectionBlock>

        {/* Top category deltas */}
        {recap.topCategoryDeltas.length > 0 && (
          <SectionBlock label="Top categories">
            <ul className="divide-y divide-brand-100 dark:divide-brand-700/60">
              {recap.topCategoryDeltas.map(d => {
                const catDiff = roundMoney(d.current - d.prior);
                return (
                  <li key={d.category} className="flex items-center justify-between py-2 gap-3">
                    <span className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                      {d.category}
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="stat-num text-sm font-semibold text-brand-700 dark:text-brand-200">
                        {fmt(d.current, { decimals: 0 })}
                      </span>
                      {catDiff !== 0 && (
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            catDiff < 0 ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'
                          )}
                        >
                          {catDiff < 0 ? '↓' : '↑'}
                          {fmt(Math.abs(catDiff), { decimals: 0 })}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </SectionBlock>
        )}

        {/* Habits — completions + points per member (warm/amber voice) */}
        <SectionBlock label="Habits">
          <p className="text-sm text-brand-900 dark:text-brand-100">
            <span className="stat-num text-2xl font-bold text-warm-700 dark:text-warm-300">
              {recap.habitCompletions}
            </span>
            <span className="ml-1.5 text-sm text-brand-500 dark:text-brand-400">
              completion{recap.habitCompletions === 1 ? '' : 's'} this week
            </span>
          </p>
          {recap.pointsByMember.length > 0 && (
            <ul className="mt-2 divide-y divide-brand-100 dark:divide-brand-700/60">
              {recap.pointsByMember.map(m => (
                <li key={m.memberId} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                    {m.name}
                  </span>
                  <span className="stat-num text-sm font-semibold text-warm-700 dark:text-warm-300">
                    {m.points} pts
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionBlock>

        {/* Streaks at risk */}
        {recap.streaksAtRisk.length > 0 && (
          <SectionBlock label="Streaks at risk">
            <ul className="space-y-2">
              {recap.streaksAtRisk.map(s => (
                <li key={s.habitTitle} className="flex items-center gap-2">
                  <Flame size={16} className="text-habit-streak shrink-0" aria-hidden="true" />
                  <span className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                    {s.habitTitle}
                  </span>
                  <span className="ml-auto text-xs font-semibold text-habit-streak shrink-0">
                    {s.streakDays}-day streak
                  </span>
                </li>
              ))}
            </ul>
          </SectionBlock>
        )}

        {/* Upcoming bills */}
        {recap.upcomingBills.length > 0 && (
          <SectionBlock label="Bills this week">
            <ul className="divide-y divide-brand-100 dark:divide-brand-700/60">
              {recap.upcomingBills.map(b => (
                <li key={`${b.title}-${b.date}`} className="flex items-center justify-between py-2 gap-3">
                  <span className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                    {b.title}
                  </span>
                  <span className="flex items-baseline gap-2 shrink-0">
                    <span className="text-xs text-brand-500 dark:text-brand-400">{b.date}</span>
                    <span className="stat-num text-sm font-semibold text-brand-700 dark:text-brand-200">
                      {fmt(b.amount, { decimals: 0 })}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </SectionBlock>
        )}

      {/* Narrative — the premium-gated section. In deck mode it lives on the
          finish card instead, so it is rendered here only without a deck. */}
      {!deck && (
        <SectionBlock label="Your recap">
          {recap.premium ? (
            <p className="text-sm leading-relaxed text-brand-700 dark:text-brand-200">
              {recap.narrative}
            </p>
          ) : (
            <div>
              <p
                className="text-sm leading-relaxed text-brand-700 dark:text-brand-200 blur-sm select-none"
                aria-hidden="true"
              >
                {recap.narrative || 'Your personalized weekly summary is ready to read.'}
              </p>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-warm-700 dark:text-warm-300">
                <Lock size={14} aria-hidden="true" />
                Unlock your personal recap with Premium
              </div>
            </div>
          )}
        </SectionBlock>
      )}
    </>
  );

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Week in review · ${recap.isoWeek}`}>
      <div className="space-y-6 pb-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<Share2 size={15} aria-hidden="true" />}
          isLoading={isSharing}
          onClick={handleShare}
          className="w-full"
        >
          Share your recap
        </Button>

        {deck ? (
          <>
            <RecapDeck
              deck={deck}
              recap={recap}
              householdName={householdSettings?.name || 'Your household'}
              onComplete={handleDeckComplete}
            />
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm font-semibold text-accent-700 dark:text-accent-300 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-btn">
                Week details
                <span className="ml-1.5 transition-transform group-open:rotate-90" aria-hidden="true">
                  ›
                </span>
              </summary>
              <div className="mt-2 space-y-6">{detailSections}</div>
            </details>
          </>
        ) : (
          detailSections
        )}
      </div>
    </Drawer>
  );
};
