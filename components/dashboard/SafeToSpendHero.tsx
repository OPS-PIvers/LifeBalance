import React, { useMemo, useState } from 'react';
import { ChevronDown, Wallet, Receipt, TrendingUp, TrendingDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '../../contexts/FirebaseHouseholdContext';
import { calculateSafeToSpendBreakdown } from '../../utils/safeToSpendCalculator';
import { cn } from '../../utils/cn';
import { haptic } from '../../utils/haptics';

const currency = (n: number) =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Hero card surfacing the app's signature metric. Shows the big number,
 * color-coded by sign, with a tap-to-expand breakdown that "shows the work"
 * (Checking − Unpaid bills) so the number is trustworthy, not magic.
 */
export const SafeToSpendHero: React.FC = () => {
  const { accounts, buckets, calendarItems, currentPeriodId, safeToSpendBreakdown: contextBreakdown } = useFinance();
  const [expanded, setExpanded] = useState(false);

  // When the context provides a memoized breakdown (Firebase provider), use it directly
  // to avoid re-expanding calendar items every render. Fall back to local calculation
  // in test mode where the mock provider does not supply it.
  const localBreakdown = useMemo(
    () =>
      contextBreakdown === undefined
        ? calculateSafeToSpendBreakdown(accounts, calendarItems, buckets, currentPeriodId)
        : null,
    [contextBreakdown, accounts, calendarItems, buckets, currentPeriodId]
  );

  const breakdown = contextBreakdown ?? localBreakdown!;

  // Headline and itemization both come from `breakdown`, so the big number can
  // never contradict the rows beneath it.
  const safeToSpend = breakdown.safeToSpend;
  const isPositive = safeToSpend >= 0;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl p-6 shadow-premium ring-1 transition-colors',
        isPositive
          ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 ring-emerald-400/30 dark:from-emerald-600 dark:to-emerald-800'
          : 'bg-gradient-to-br from-rose-500 to-rose-600 ring-rose-400/30 dark:from-rose-600 dark:to-rose-800'
      )}
    >
      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
          haptic('light');
        }}
        aria-expanded={expanded}
        aria-controls="sts-breakdown"
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">Safe to Spend</p>
            <p className="mt-1 text-4xl font-bold font-mono tracking-tight tabular-nums text-white">
              {currency(safeToSpend)}
            </p>
            <p className="mt-1 text-xs font-medium text-white/70">
              {breakdown.nextPaycheckDate
                ? `Until your next paycheck on ${format(parseISO(breakdown.nextPaycheckDate), 'MMM d')}`
                : 'Available from checking'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-white/15 p-2 text-white">
              {isPositive ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1 text-xs font-bold text-white/80">
          {expanded ? 'Hide breakdown' : 'How is this calculated?'}
          <ChevronDown
            size={14}
            className={cn('transition-transform', expanded && 'rotate-180')}
          />
        </div>
      </button>

      {expanded && (
        <div id="sts-breakdown" className="mt-4 space-y-2 border-t border-white/20 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <Row icon={<Wallet size={14} />} label="Checking balance" value={currency(breakdown.checkingBalance)} />
          <Row
            icon={<Receipt size={14} />}
            label="Unpaid bills this period"
            value={`- ${currency(breakdown.unpaidBills)}`}
          />
          <div className="flex items-center justify-between border-t border-white/20 pt-2 text-sm font-bold text-white">
            <span>Safe to spend</span>
            <span className="font-mono tabular-nums">{currency(breakdown.safeToSpend)}</span>
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
