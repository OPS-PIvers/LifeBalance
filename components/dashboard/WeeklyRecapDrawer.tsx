import React from 'react';
import { Lock, Flame, TrendingDown, TrendingUp } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import Eyebrow from '@/components/ui/Eyebrow';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { roundMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import type { WeeklyRecap } from '@/types/schema';

/**
 * WeeklyRecapDrawer — bottom-sheet detail view of one weekly recap (Plan 02).
 *
 * Renders every recap section from the pre-computed server numbers: spend vs
 * prior week, top category deltas, habit completions + points per member,
 * streaks at risk, upcoming bills, and the narrative (blurred behind a small
 * upsell row when `premium: false`). Statically imported by the Dashboard-only
 * WeeklyRecapCard — the Dashboard page is itself lazy-loaded, so the Drawer/
 * framer-motion dependency stays off the boot bundle (same rationale as other
 * page-mounted drawers; only always-mounted shells must use LazyMount).
 */

interface WeeklyRecapDrawerProps {
  recap: WeeklyRecap | null;
  isOpen: boolean;
  onClose: () => void;
}

const SectionBlock: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <Eyebrow className="mb-2">{label}</Eyebrow>
    {children}
  </div>
);

export const WeeklyRecapDrawer: React.FC<WeeklyRecapDrawerProps> = ({ recap, isOpen, onClose }) => {
  const fmt = useFormatCurrency();

  if (!recap) return null;

  const diff = roundMoney(recap.totalSpend - recap.priorWeekSpend);
  const spentLess = diff < 0;
  const DiffIcon = spentLess ? TrendingDown : TrendingUp;

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Week in review · ${recap.isoWeek}`}>
      <div className="space-y-6 pb-2">
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
                  spentLess ? 'text-money-pos' : 'text-money-neg'
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
                            catDiff < 0 ? 'text-money-pos' : 'text-money-neg'
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

        {/* Narrative — the premium-gated section */}
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
      </div>
    </Drawer>
  );
};
