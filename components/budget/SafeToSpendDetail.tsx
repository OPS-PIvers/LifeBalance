import React, { useState } from 'react';
import { ChevronDown, Wallet, Receipt, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';

/**
 * Read-only Safe-to-Spend breakdown surfaced in the Money → Overview tab. It
 * "shows the work" behind the headline number (Checking − Unpaid bills −
 * Pending) using the memoized `safeToSpendBreakdown` the context already
 * exposes — no recomputation, no logic change. The Home hero stays the single
 * elevated surface; this is a calm grouped-flat companion in the domain.
 *
 * The headline stays always visible; the itemized rows + disclaimer are
 * collapsed behind a "How is this calculated?" toggle by default — the app's
 * standard show-the-work interaction language for this content.
 */
export const SafeToSpendDetail: React.FC = () => {
  const { safeToSpendBreakdown: breakdown } = useFinance();
  const fmt = useFormatCurrency();
  const [expanded, setExpanded] = useState(false);

  if (breakdown === undefined) return null;

  const isPositive = breakdown.safeToSpend >= 0;

  return (
    <Section title="Safe to spend">
      <SurfaceList>
        {/* Headline */}
        <Row className="justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-brand-800 dark:text-brand-100">Available to spend</p>
            <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
              {breakdown.nextPaycheckDate
                ? `Until your next paycheck on ${format(parseISO(breakdown.nextPaycheckDate), 'MMM d')}`
                : 'Available from checking'}
            </p>
          </div>
          <span
            className={`font-mono text-xl font-bold tabular-nums shrink-0 ${
              isPositive ? 'text-money-pos' : 'text-money-neg'
            }`}
          >
            {fmt(breakdown.safeToSpend)}
          </span>
        </Row>

        {expanded && (
          <div
            id="sts-detail-breakdown"
            className="animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
          >
            {/* Checking balance */}
            <DetailRow
              icon={<Wallet size={16} />}
              label="Checking balance"
              sub="Available cash"
              value={fmt(breakdown.checkingBalance)}
            />

            {/* Unpaid bills */}
            <DetailRow
              icon={<Receipt size={16} />}
              label="Unpaid bills this period"
              sub="Reserved until next paycheck"
              value={`- ${fmt(breakdown.unpaidBills)}`}
              negative
            />

            {/* Pending transactions */}
            {breakdown.pendingSpend > 0 && (
              <DetailRow
                icon={<Clock size={16} />}
                label="Pending transactions"
                sub="Spent but not yet cleared"
                value={`- ${fmt(breakdown.pendingSpend)}`}
                negative
              />
            )}

            <div className="px-4 pt-3 pb-3.5 hairline-divider">
              <p className="text-xxs text-brand-400 dark:text-brand-500 leading-relaxed">
                Your available cash after bills due before your next paycheck and pending
                (un-cleared) transactions. Bucket limits are not subtracted from this number.
              </p>
            </div>
          </div>
        )}

        {/* Toggle */}
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls="sts-detail-breakdown"
          className="flex w-full items-center gap-1 px-4 py-3 hairline-divider text-left text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
        >
          {expanded ? 'Hide breakdown' : 'How is this calculated?'}
          <ChevronDown
            size={14}
            className={cn(
              'transition-transform duration-(--duration-base) ease-(--ease-standard)',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </SurfaceList>
    </Section>
  );
};

const DetailRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
  negative?: boolean;
}> = ({ icon, label, sub, value, negative = false }) => (
  <Row className="justify-between">
    <div className="flex items-center gap-3 min-w-0">
      <span className="w-9 h-9 rounded-card bg-brand-100 border border-brand-200 flex items-center justify-center text-brand-500 shrink-0 dark:bg-brand-700/50 dark:border-brand-700 dark:text-brand-300">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate">{label}</p>
        <p className="text-xxs text-brand-400 dark:text-brand-500">{sub}</p>
      </div>
    </div>
    <span
      className={`font-mono text-sm font-bold tabular-nums shrink-0 ${
        negative ? 'text-money-neg' : 'text-brand-900 dark:text-brand-50'
      }`}
    >
      {value}
    </span>
  </Row>
);
