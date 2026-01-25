import React, { useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfWeek, subWeeks, isSameWeek, parseISO, formatDistanceToNow } from 'date-fns';
import { TrendingUp, TrendingDown, Receipt, ArrowRight, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';

export const MoneyPulseWidget: React.FC = () => {
  const { transactions } = useHousehold();

  // 1. Calculate Spending Pulse
  const spendingStats = useMemo(() => {
    const now = new Date();
    // Week starts on Monday (1)
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const lastWeekStart = subWeeks(currentWeekStart, 1);

    let thisWeekTotal = 0;
    let lastWeekTotal = 0;

    transactions.forEach(t => {
      // Exclude income
      if (t.category === 'Income') return;
      if (t.status === 'pending_review') return;

      const date = parseISO(t.date);
      if (isSameWeek(date, now, { weekStartsOn: 1 })) {
        thisWeekTotal += t.amount;
      } else if (isSameWeek(date, lastWeekStart, { weekStartsOn: 1 })) {
        lastWeekTotal += t.amount;
      }
    });

    const diff = thisWeekTotal - lastWeekTotal;
    const percentChange = lastWeekTotal > 0 ? (diff / lastWeekTotal) * 100 : 0;

    return {
      thisWeek: thisWeekTotal,
      lastWeek: lastWeekTotal,
      percentChange,
      isHigher: diff > 0
    };
  }, [transactions]);

  // 2. Get Recent Transactions
  const recentTransactions = useMemo(() => {
    return transactions
      .filter(t => t.category !== 'Income' && t.status !== 'pending_review')
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3);
  }, [transactions]);

  if (transactions.length === 0) return null;

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-2xl p-6 shadow-glass ring-1 ring-black/5 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900 flex items-center gap-2">
          <div className="p-1.5 bg-emerald-100/50 text-emerald-600 rounded-lg ring-1 ring-emerald-200/50">
             <Wallet size={14} />
          </div>
          Money Pulse
        </h2>
        <Link
          to="/budget"
          className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
          View Budget <ArrowRight size={12} />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-50/50 rounded-xl p-4 border border-slate-100/50">
           <p className="text-xs text-slate-500 font-medium mb-1">Spent This Week</p>
           <p className="text-2xl font-bold tracking-tight text-slate-900">${spendingStats.thisWeek.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</p>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm flex flex-col justify-center">
           <div
             className={`flex items-center gap-1.5 text-xs font-bold ${
               spendingStats.percentChange === 0 && spendingStats.isHigher
                 ? 'text-slate-400'
                 : spendingStats.isHigher
                   ? 'text-rose-500'
                   : 'text-emerald-500'
             }`}
           >
             {spendingStats.percentChange === 0 && spendingStats.isHigher ? (
               <ArrowRight size={16} />
             ) : spendingStats.isHigher ? (
               <TrendingUp size={16} />
             ) : (
               <TrendingDown size={16} />
             )}
             <span>
               {spendingStats.percentChange === 0 && spendingStats.isHigher
                 ? 'N/A'
                 : `${Math.abs(spendingStats.percentChange).toFixed(0)}%`}
             </span>
           </div>
           <p className="text-xxs text-slate-400 font-medium mt-1">
             {spendingStats.percentChange === 0 && spendingStats.isHigher
               ? 'No spending last week to compare'
               : 'vs Last Week'}
           </p>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-slate-400 mb-3">Recent Activity</h3>
        <div className="space-y-3">
          {recentTransactions.map(tx => (
            <div key={tx.id} className="flex items-center justify-between group">
              <div className="flex items-center gap-3">
                 <div className="w-9 h-9 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 shrink-0 group-hover:bg-white group-hover:shadow-sm transition-all duration-200">
                    <Receipt size={14} />
                 </div>
                 <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate max-w-[140px] group-hover:text-slate-900 transition-colors">{tx.merchant}</p>
                    <p className="text-xs text-slate-400 font-medium">{formatDistanceToNow(parseISO(tx.date), { addSuffix: true })}</p>
                 </div>
              </div>
              <span className="font-medium tracking-tight text-slate-900 text-sm">
                 ${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
          ))}
          {recentTransactions.length === 0 && (
            <p className="text-xs text-slate-400 italic text-center py-4">No recent transactions</p>
          )}
        </div>
      </div>
    </div>
  );
};
