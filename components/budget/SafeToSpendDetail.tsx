import React from 'react';
import { Wallet, Receipt, Clock } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

/**
 * Read-only Safe-to-Spend breakdown surfaced in the Money → Overview tab. It
 * "shows the work" behind the headline number (Checking − Unpaid bills −
 * Pending) using the memoized `safeToSpendBreakdown` the context already
 * exposes — no recomputation, no logic change. The Home hero stays the single
 * elevated surface; this is a calm grouped-flat companion in the domain.
 */
export const SafeToSpendDetail: React.FC = () => {
  const { safeToSpendBreakdown: breakdown } = useFinance();
  const fmt = useFormatCurrency();

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
      </SurfaceList>

      <p className="px-1 mt-2 text-xxs text-brand-400 dark:text-brand-500 leading-relaxed">
        Your available cash after bills due before your next paycheck and pending (un-cleared)
        transactions. Bucket limits are not subtracted from this number.
      </p>
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
