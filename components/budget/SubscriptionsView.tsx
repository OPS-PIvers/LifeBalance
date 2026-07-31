import React, { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { summarizeRecurringItems, RecurringSummaryItem } from '@/utils/subscriptionsSummary';
import { SurfaceList, Row, Section } from '@/components/ui/Section';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import EmptyState from '@/components/ui/EmptyState';

const FREQUENCY_LABEL: Record<'weekly' | 'bi-weekly' | 'monthly', string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Bi-weekly',
  monthly: 'Monthly',
};

/**
 * Rollup of recurring EXPENSE calendar items, split by the user-set
 * `isSubscription` flag (F-MONEY-05: recurring alone does NOT make a bill a
 * subscription — mortgage/car payments are recurring but not subscriptions).
 * Each row carries an inline toggle so items can be (un)marked right here,
 * persisted via `updateCalendarItem`.
 */
const SubscriptionsView: React.FC = () => {
  const { calendarItems, updateCalendarItem } = useFinance();
  const fmt = useFormatCurrency();

  const summary = useMemo(() => summarizeRecurringItems(calendarItems), [calendarItems]);

  const toggleSubscription = (entry: RecurringSummaryItem, next: boolean) => {
    void updateCalendarItem({ ...entry.item, isSubscription: next });
  };

  if (summary.items.length === 0) {
    return (
      <EmptyState
        variant="surface"
        icon={<RefreshCw className="w-full h-full" />}
        title="No subscriptions yet"
        description="Recurring expense bills you add to the Calendar (Netflix, gym, rent, etc.) will show up here as a monthly total."
      />
    );
  }

  const renderRow = (entry: RecurringSummaryItem, isSubscription: boolean) => {
    const { item, monthlyEquivalent } = entry;
    return (
      <Row key={item.id} className="justify-between gap-3">
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
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="stat-num text-sm font-medium text-brand-700 dark:text-brand-200">
            {fmt(monthlyEquivalent)}/mo
          </span>
          {/* self-end overrides the primitive's self-center (a row-layout
              vertical-centering default): in this COLUMN stack self-center
              acts horizontally, centering each toggle under its amount text
              so rows with wider amounts showed visibly offset toggles. */}
          <Switch
            className="self-end"
            checked={isSubscription}
            onCheckedChange={(next) => toggleSubscription(entry, next)}
            aria-label={`Mark ${item.title} as a subscription`}
          />
        </div>
      </Row>
    );
  };

  return (
    <div className="space-y-6">
      <Section title="Recurring spend">
        <SurfaceList>
          <Row className="justify-between">
            <span className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200">
              Subscriptions
            </span>
            <span className="stat-num text-lg font-semibold text-money-neg dark:text-money-negDark">
              {fmt(summary.subscriptionsMonthly)}/mo
            </span>
          </Row>
          <Row className="justify-between">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
              Other recurring bills
            </span>
            <span className="stat-num text-sm font-medium text-brand-700 dark:text-brand-200">
              {fmt(summary.otherBillsMonthly)}/mo
            </span>
          </Row>
          <Row className="justify-between">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-200">
              All recurring spend
            </span>
            <span className="stat-num text-sm font-medium text-brand-700 dark:text-brand-200">
              {fmt(summary.totalMonthly)}/mo
            </span>
          </Row>
        </SurfaceList>
      </Section>

      <Section title={`Subscriptions (${summary.subscriptions.length})`}>
        {summary.subscriptions.length === 0 ? (
          <SurfaceList>
            <Row>
              <p className="text-sm text-brand-450 dark:text-brand-400">
                Nothing marked as a subscription yet. Use the toggle on a
                recurring item below (or in its Calendar editor) to mark it.
              </p>
            </Row>
          </SurfaceList>
        ) : (
          <SurfaceList>
            {summary.subscriptions.map(entry => renderRow(entry, true))}
          </SurfaceList>
        )}
      </Section>

      {summary.otherBills.length > 0 && (
        <Section title={`Other recurring items (${summary.otherBills.length})`}>
          <SurfaceList>
            {summary.otherBills.map(entry => renderRow(entry, false))}
          </SurfaceList>
        </Section>
      )}
    </div>
  );
};

export default SubscriptionsView;
