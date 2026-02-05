import React, { useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { expandCalendarItems } from '../../utils/calendarRecurrence';
import { startOfToday, addDays, parseISO, isSameDay, isTomorrow, format } from 'date-fns';
import { CalendarClock, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface UpcomingBillsWidgetProps {
  onPay: (id: string) => void;
}

export const UpcomingBillsWidget: React.FC<UpcomingBillsWidgetProps> = ({ onPay }) => {
  const { calendarItems } = useHousehold();

  const upcomingBills = useMemo(() => {
    const today = startOfToday();
    const twoWeeksOut = addDays(today, 14);

    // Expand recurring items
    const expanded = expandCalendarItems(calendarItems, today, twoWeeksOut);

    // Filter and sort
    return expanded
      .filter(item => item.type === 'expense' && !item.isPaid)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 3);
  }, [calendarItems]);

  if (upcomingBills.length === 0) return null;

  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <div className="p-1.5 bg-rose-100 text-rose-600 rounded-lg">
             <CalendarClock size={14} />
          </div>
          Upcoming Bills
        </h2>
        <Link
          to="/budget"
          className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
          Calendar <ArrowRight size={12} />
        </Link>
      </div>

      <div className="space-y-3">
        {upcomingBills.map(bill => {
           const date = parseISO(bill.date);
           let dateLabel = format(date, 'MMM d');
           let urgencyClass = 'text-slate-500';

           if (isSameDay(date, startOfToday())) {
             dateLabel = 'Today';
             urgencyClass = 'text-rose-600 font-bold';
           } else if (isTomorrow(date)) {
             dateLabel = 'Tomorrow';
             urgencyClass = 'text-amber-600 font-bold';
           }

           return (
            <div key={bill.id} className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 font-bold text-xs shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all">
                    {format(date, 'd')}
                 </div>
                 <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate max-w-[120px]">{bill.title}</p>
                    <p className={`text-xs ${urgencyClass}`}>{dateLabel}</p>
                 </div>
              </div>
              <div className="flex items-center gap-3">
                 <span className="font-mono font-bold text-slate-900 text-sm">
                    ${bill.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                 </span>
                 <button
                   onClick={() => onPay(bill.id)}
                   className="p-2 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 hover:text-emerald-700 rounded-xl transition-colors"
                   title="Pay Bill"
                   aria-label={`Pay ${bill.title}`}
                 >
                   <CheckCircle2 size={18} />
                 </button>
              </div>
            </div>
           );
        })}
      </div>
    </div>
  );
};
