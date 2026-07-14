import React, { useState } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { MoneyPulseWidget } from '@/components/dashboard/MoneyPulseWidget';
import { UpcomingBillsWidget } from '@/components/dashboard/UpcomingBillsWidget';
import { CategorySpendWidget } from '@/components/dashboard/CategorySpendWidget';
import { AccountPicker } from '@/components/budget/AccountPicker';
import { SafeToSpendDetail } from '@/components/budget/SafeToSpendDetail';

/**
 * Money → Overview tab. Hosts the money widgets that were relocated off Home
 * (Upcoming bills, MoneyPulse, Category spend). Each widget is imported as-is
 * (already restyled grouped-flat) — this file only composes them and owns the
 * small "pay bill" confirmation the bills widget needs, mirroring the Home pay
 * flow with FROZEN context mutations.
 *
 * The Safe-to-Spend headline card was removed from the top (UX audit Batch 3,
 * owner decision): the figure is permanently visible in `TopToolbar`, and this
 * tab is the deep-link destination for that same number — a redundant extra
 * tap to see it again. The breakdown survives as `SafeToSpendDetail`'s
 * collapsed "How is this calculated?" disclosure at the BOTTOM (it's the app's
 * only breakdown UI for the metric). Upcoming Bills leads because it's the
 * only widget here with real per-row actions ("Pay Bill" CTAs).
 */
const MoneyOverview: React.FC = () => {
  const { payCalendarItem } = useFinance();
  const [payModalItem, setPayModalItem] = useState<{ id: string; amount: number } | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-(--duration-base)">
      <UpcomingBillsWidget onPay={(id, amount) => setPayModalItem({ id, amount })} />
      <MoneyPulseWidget />
      <CategorySpendWidget />
      <SafeToSpendDetail />

      {/* Pay sheet for calendar items (from the Upcoming bills widget) — the
          amount is editable at pay-time for variable bills. */}
      <AccountPicker
        isOpen={!!payModalItem}
        onClose={() => setPayModalItem(null)}
        editableAmount={payModalItem?.amount}
        onSelect={(accountId, amount) => {
          if (payModalItem) {
            payCalendarItem(
              payModalItem.id,
              accountId,
              amount !== undefined ? { actualAmount: amount } : undefined
            );
          }
          setPayModalItem(null);
        }}
      />
    </div>
  );
};

export default MoneyOverview;
