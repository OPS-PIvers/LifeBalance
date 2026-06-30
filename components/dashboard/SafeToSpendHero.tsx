import React, { useState } from 'react';
import { ChevronDown, Wallet, Receipt, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { cn } from '@/utils/cn';
import { haptic } from '@/utils/haptics';

/**
 * Hero card surfacing the app's signature metric. Shows the big number,
 * color-coded by sign, with a tap-to-expand breakdown that "shows the work"
 * (Checking − Unpaid bills − Pending) so the number is trustworthy, not magic.
 *
 * This is the single elevated surface on Home: a solid evergreen (positive) or
 * money-red (negative) fill with the hero radius + the restrained raised shadow.
 * No gradients, no glass — the elevation alone signals "this is the headline."
 */
export const SafeToSpendHero: React.FC = () => {
  const { safeToSpendBreakdown: breakdown } = useFinance();
  const fmt = useFormatCurrency();
  const [expanded, setExpanded] = useState(false);

  // Render a loading skeleton while the context hasn't produced a breakdown yet.
  if (breakdown === undefined) {
    return (
      <div className="relative overflow-hidden rounded-lg p-6 shadow-raised bg-brand-200 dark:bg-brand-700 animate-pulse">
        <div className="h-4 w-28 rounded bg-brand-300/70 dark:bg-brand-600 mb-3" />
        <div className="h-10 w-48 rounded bg-brand-300/70 dark:bg-brand-600 mb-2" />
        <div className="h-3 w-40 rounded bg-brand-300/70 dark:bg-brand-600" />
      </div>
    );
  }

  // Headline and itemization both come from `breakdown`, so the big number can
  // never contradict the rows beneath it.
  const safeToSpend = breakdown.safeToSpend;
  const isPositive = safeToSpend >= 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg p-6 shadow-raised transition-colors',
        isPositive
          ? 'bg-accent-600 dark:bg-accent-700'
          : 'bg-money-neg dark:bg-money-neg/90'
      )}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded(v => !v);
          haptic('light');
        }}
        aria-expanded={expanded}
        aria-controls="sts-breakdown"
        aria-label={expanded ? 'Hide Safe to Spend breakdown' : 'Show Safe to Spend breakdown'}
        className="w-full text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/50 rounded-card"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/75">Safe to Spend</p>
            <p className="mt-1 text-4xl font-bold stat-num text-white">
              {fmt(safeToSpend)}
            </p>
            <p className="mt-1 text-xs font-medium text-white/75">
              {breakdown.nextPaycheckDate
                ? `Until your next paycheck on ${format(parseISO(breakdown.nextPaycheckDate), 'MMM d')}`
                : 'Available from checking'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-card bg-white/15 p-2 text-white">
              {isPositive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-white/85">
          {expanded ? 'Hide breakdown' : 'How is this calculated?'}
          <ChevronDown size={14} className={cn('transition-transform duration-(--duration-base) ease-(--ease-standard)', expanded && 'rotate-180')} />
        </div>
      </button>

      {expanded && (
        <div
          id="sts-breakdown"
          className="mt-4 space-y-2 border-t border-white/20 pt-4 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
        >
          <Row icon={<Wallet size={14} />} label="Checking balance" value={fmt(breakdown.checkingBalance)} />
          <Row
            icon={<Receipt size={14} />}
            label="Unpaid bills this period"
            value={`- ${fmt(breakdown.unpaidBills)}`}
          />
          {breakdown.pendingSpend > 0 && (
            <Row
              icon={<Clock size={14} />}
              label="Pending transactions"
              value={`- ${fmt(breakdown.pendingSpend)}`}
            />
          )}
          <div className="flex items-center justify-between border-t border-white/20 pt-2 text-sm font-bold text-white">
            <span>Safe to spend</span>
            <span className="font-mono tabular-nums">{fmt(breakdown.safeToSpend)}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="flex items-center justify-between text-sm text-white/90">
    <span className="flex items-center gap-2">
      <span className="text-white/70">{icon}</span>
      {label}
    </span>
    <span className="font-mono tabular-nums">{value}</span>
  </div>
);
