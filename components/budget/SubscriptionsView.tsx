import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { summarizeRecurringItems } from '@/utils/subscriptionsSummary';
import { SurfaceList, Row, Section } from '@/components/ui/Section';
import { Badge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';

const FREQUENCY_LABEL: Record<'weekly' | 'bi-weekly' | 'monthly', string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
};

/**
 * Read-only rollup of every recurring EXPENSE calendar item ("subscriptions &
 * recurring bills"), grouped by cadence with a monthly-equivalent cost and a
 * "$X/month" total. Calendar-only (F-MONEY-05 v1): sources straight from
 * `CalendarItem` recurring templates via `summarizeRecurringItems` — no
 * cross-referencing against verified transactions yet (see roadmap note).
 */
const SubscriptionsView: React.FC = () => {
  const { calendarItems } = useFinance();
  const fmt = useFormatCurrency();

  const summary = useMemo(() => summarizeRecurringItems(calendarItems), [calendarItems]);

  if (summary.items.length === 0) {
    return (
      <EmptyState
        variant="surface"
        icon={<RefreshCw className="w-full h-full" />}
        title="No subscriptions yet"
        description="Recurring expense bills you add to the Calendar tab (Netflix, gym, rent, etc.) will show up here as a monthly total."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Section title="Recurring spend">
        <SurfaceList>
          <Row className="justify-between">
            <span className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200">
              You spend on subscriptions &amp; bills
            </span>
            <span className="stat-num text-lg font-semibold text-money-neg dark:text-money-negDark">
              {fmt(summary.totalMonthly)}/mo
            </span>
          </Row>
        </SurfaceList>
      </Section>

      <Section title={`Recurring items (${summary.items.length})`}>
        <SurfaceList>
          {summary.items.map(({ item, monthlyEquivalent }) => (
            <Row key={item.id} className="justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-brand-800 dark:text-brand-100 truncate">
                  {item.title}
                </p>
                <div className="mt-0.5 flex items-center gap-2">
                  <Badge variant="neutral" size="sm">
                    {FREQUENCY_LABEL[item.frequency]}
                  </Badge>
                  <span className="text-xs text-brand-450 dark:text-brand-400">
                    {fmt(item.amount)} per {item.frequency === 'monthly' ? 'month' : 'cycle'}
                  </span>
                </div>
              </div>
              <span className="stat-num shrink-0 text-sm font-medium text-brand-700 dark:text-brand-200">
                {fmt(monthlyEquivalent)}/mo
              </span>
            </Row>
          ))}
        </SurfaceList>
      </Section>
    </div>
  );
};

export default SubscriptionsView;
