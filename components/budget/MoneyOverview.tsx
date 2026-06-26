import React, { useState } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { SafeToSpendDetail } from './SafeToSpendDetail';
import { MoneyPulseWidget } from '@/components/dashboard/MoneyPulseWidget';
import { UpcomingBillsWidget } from '@/components/dashboard/UpcomingBillsWidget';
import { CategorySpendWidget } from '@/components/dashboard/CategorySpendWidget';

/**
 * Money → Overview tab. Hosts the Safe-to-Spend detail plus the money widgets
 * that were relocated off Home (MoneyPulse, Upcoming bills, Category spend).
 * Each widget is imported as-is (already restyled grouped-flat) — this file only
 * composes them and owns the small "pay bill" confirmation the bills widget
 * needs, mirroring the Home pay flow with FROZEN context mutations.
 */
const MoneyOverview: React.FC = () => {
  const { accounts, payCalendarItem } = useFinance();
  const fmt = useFormatCurrency();
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-(--duration-base)">
      <SafeToSpendDetail />
      <MoneyPulseWidget />
      <UpcomingBillsWidget onPay={setPayModalItemId} />
      <CategorySpendWidget />

      {/* Pay Modal for calendar items (from the Upcoming bills widget) */}
      {payModalItemId && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 bg-brand-900/60">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="overview-pay-bill-title"
            className="bg-white dark:bg-brand-800 w-full max-w-sm rounded-card p-6 shadow-raised border border-brand-200 dark:border-brand-700 animate-in zoom-in-95 duration-(--duration-base)"
          >
            <h3
              id="overview-pay-bill-title"
              className="font-display font-semibold text-lg text-brand-900 dark:text-brand-100 mb-2"
            >
              Confirm Payment
            </h3>
            <p className="text-sm text-brand-500 dark:text-brand-400 mb-6 leading-relaxed">
              Select which account to deduct this payment from.
            </p>

            <div className="space-y-3 mb-6">
              {accounts
                .filter(a => a.type !== 'credit')
                .map(acc => (
                  <button
                    key={acc.id}
                    onClick={() => {
                      payCalendarItem(payModalItemId, acc.id);
                      setPayModalItemId(null);
                    }}
                    className="w-full p-4 flex justify-between items-center bg-white dark:bg-brand-700/40 hover:bg-brand-50 dark:hover:bg-brand-700 rounded-card border border-brand-200 dark:border-brand-700 hover:border-brand-300 dark:hover:border-brand-600 transition-colors duration-(--duration-fast) ease-(--ease-standard) group focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                  >
                    <span className="font-semibold text-brand-700 dark:text-brand-200 text-sm group-hover:text-brand-900 dark:group-hover:text-brand-100">
                      {acc.name}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-brand-400 dark:text-brand-500 group-hover:text-brand-600 dark:group-hover:text-brand-300">
                      {fmt(acc.balance)}
                    </span>
                  </button>
                ))}
            </div>

            <button
              onClick={() => setPayModalItemId(null)}
              className="w-full py-3 text-brand-400 dark:text-brand-500 hover:text-brand-600 dark:hover:text-brand-300 font-semibold transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MoneyOverview;
