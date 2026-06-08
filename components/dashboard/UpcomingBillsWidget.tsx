import React, { useMemo } from 'react';
import { useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { startOfToday, addDays, parseISO, isSameDay, isTomorrow, format } from 'date-fns';
import { CalendarClock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

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

  const upcomingBills = useMemo(() => {
    // Filter, sort, and transform
    return expanded
      .filter(item => item.type === 'expense' && !item.isPaid)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, MAX_BILLS_TO_SHOW)
      .map(bill => {
        const date = parseISO(bill.date);
        let dateLabel = format(date, 'MMM d');
        let urgencyClass = 'text-slate-500 dark:text-slate-400';

        if (isSameDay(date, today)) {
          dateLabel = 'Today';
          urgencyClass = 'text-rose-600 font-bold';
        } else if (isTomorrow(date)) {
          dateLabel = 'Tomorrow';
          urgencyClass = 'text-amber-600 font-bold';
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
    <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <div className="p-1.5 bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300 rounded-lg">
             <CalendarClock size={14} />
          </div>
          Upcoming Bills
        </h2>
        <Link
          to="/budget"
          className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
        >
          Calendar <ArrowRight size={12} />
        </Link>
      </div>

      <div className="space-y-3">
        {upcomingBills.map(bill => (
            <div key={bill.id} className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all dark:bg-slate-700/50 dark:border-slate-700 dark:text-slate-500 dark:group-hover:bg-slate-700">
                    {bill.displayDate}
                 </div>
                 <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate max-w-[120px]">{bill.title}</p>
                    <p className={`text-xs ${bill.urgencyClass}`}>{bill.dateLabel}</p>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                 <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                    ${bill.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                 </span>
                 <button
                   onClick={() => onPay(bill.id)}
                   className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-700 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 rounded-xl transition-colors"
                   title="Pay Bill"
                   aria-label={`Pay ${bill.title}`}
                 >
                   <CheckCircle2 size={18} />
                 </button>
              </div>
            </div>
        ))}
      </div>
    </div>
  );
};
