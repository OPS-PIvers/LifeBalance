import React, { useMemo } from 'react';
import { useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { startOfToday, addDays, parseISO, isSameDay, isTomorrow, format } from 'date-fns';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

const UPCOMING_DAYS_WINDOW = 14;
const MAX_BILLS_TO_SHOW = 3;

interface UpcomingBillsWidgetProps {
  onPay: (id: string) => void;
}

export const UpcomingBillsWidget: React.FC<UpcomingBillsWidgetProps> = ({ onPay }) => {
  // Stable window bounds (per day) feed the shared memoized expansion helper so
  // the recurring-item expansion is reused across renders.
  const today = useMemo(() => startOfToday(), []);
  const twoWeeksOut = useMemo(() => addDays(today, UPCOMING_DAYS_WINDOW), [today]);
  const expanded = useExpandedCalendarItems(today, twoWeeksOut);
  const fmt = useFormatCurrency();

  const upcomingBills = useMemo(() => {
    return expanded
      .filter(item => item.type === 'expense' && !item.isPaid)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX_BILLS_TO_SHOW)
      .map(bill => {
        const date = parseISO(bill.date);
        let dateLabel = format(date, 'MMM d');
        let urgencyClass = 'text-brand-500 dark:text-brand-400';

        if (isSameDay(date, today)) {
          dateLabel = 'Today';
          urgencyClass = 'text-money-neg font-bold';
        } else if (isTomorrow(date)) {
          dateLabel = 'Tomorrow';
          urgencyClass = 'text-warm-600 dark:text-warm-400 font-bold';
        }

        return {
          ...bill,
          displayDate: format(date, 'd'),
          dateLabel,
          urgencyClass
        };
      });
  }, [expanded, today]);

  if (upcomingBills.length === 0) return null;

  return (
    <Section
      title="Upcoming bills"
      action={
        <Link
          to="/budget"
          className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 transition-colors"
        >
          Calendar <ArrowRight size={12} />
        </Link>
      }
    >
      <SurfaceList>
        {upcomingBills.map(bill => (
          <Row key={bill.id} className="justify-between group">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-card bg-brand-100 border border-brand-200 flex items-center justify-center text-brand-500 font-mono font-bold tabular-nums text-xs shrink-0 dark:bg-brand-700/50 dark:border-brand-700 dark:text-brand-300">
                {bill.displayDate}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate max-w-[120px]">{bill.title}</p>
                <p className={`text-xs ${bill.urgencyClass}`}>{bill.dateLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50 text-sm">
                {fmt(bill.amount, { decimals: 0 })}
              </span>
              <button
                onClick={() => onPay(bill.id)}
                className="p-2 text-money-pos bg-money-bgPos hover:brightness-95 dark:bg-money-pos/15 dark:hover:bg-money-pos/25 rounded-btn transition-[filter,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                title="Pay Bill"
                aria-label={`Pay ${bill.title}`}
              >
                <CheckCircle2 size={18} />
              </button>
            </div>
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
};
