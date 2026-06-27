import React, { useState } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { SafeToSpendDetail } from './SafeToSpendDetail';
import { MoneyPulseWidget } from '@/components/dashboard/MoneyPulseWidget';
import { UpcomingBillsWidget } from '@/components/dashboard/UpcomingBillsWidget';
import { CategorySpendWidget } from '@/components/dashboard/CategorySpendWidget';
import { AccountPicker } from '@/components/budget/AccountPicker';

/**
 * Money → Overview tab. Hosts the Safe-to-Spend detail plus the money widgets
 * that were relocated off Home (MoneyPulse, Upcoming bills, Category spend).
 * Each widget is imported as-is (already restyled grouped-flat) — this file only
 * composes them and owns the small "pay bill" confirmation the bills widget
 * needs, mirroring the Home pay flow with FROZEN context mutations.
 */
const MoneyOverview: React.FC = () => {
  const { payCalendarItem } = useFinance();
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-(--duration-base)">
      <SafeToSpendDetail />
      <MoneyPulseWidget />
      <UpcomingBillsWidget onPay={setPayModalItemId} />
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
