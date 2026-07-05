import React, { useState } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { MoneyPulseWidget } from '@/components/dashboard/MoneyPulseWidget';
import { UpcomingBillsWidget } from '@/components/dashboard/UpcomingBillsWidget';
import { CategorySpendWidget } from '@/components/dashboard/CategorySpendWidget';
import { AccountPicker } from '@/components/budget/AccountPicker';

/**
 * Money → Overview tab. Hosts the money widgets that were relocated off Home
 * (Upcoming bills, MoneyPulse, Category spend). Each widget is imported as-is
 * (already restyled grouped-flat) — this file only composes them and owns the
 * small "pay bill" confirmation the bills widget needs, mirroring the Home pay
 * flow with FROZEN context mutations.
 *
 * The Safe-to-Spend headline/breakdown card (`SafeToSpendDetail`) was removed
 * (UX audit Batch 3, owner decision): the figure is permanently visible in
 * `TopToolbar`, and this tab was the deep-link destination for that same
 * number — a redundant extra tap to see it again. Upcoming Bills leads because
 * it's the only widget here with real per-row actions ("Pay Bill" CTAs).
 */
const MoneyOverview: React.FC = () => {
  const { payCalendarItem } = useFinance();
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-(--duration-base)">
      <UpcomingBillsWidget onPay={setPayModalItemId} />
      <MoneyPulseWidget />
      <CategorySpendWidget />

      {/* Pay sheet for calendar items (from the Upcoming bills widget) */}
      <AccountPicker
        isOpen={!!payModalItemId}
        onClose={() => setPayModalItemId(null)}
        onSelect={(accountId) => {
          if (payModalItemId) payCalendarItem(payModalItemId, accountId);
          setPayModalItemId(null);
        }}
      />
    </div>
  );
};

export default MoneyOverview;
