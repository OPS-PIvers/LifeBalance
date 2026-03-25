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
    <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-premium ring-1 ring-black/5 rounded-3xl p-8 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded-lg">
             <Wallet size={14} />
          </div>
          Money Pulse
        </h2>
        <Link
          to="/budget"
          className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
          View Budget <ArrowRight size={12} />
        </Link>
      </div>

      <div className="mb-6 px-1">
        <p className="text-xs text-slate-500 font-medium mb-1">Spent This Week</p>
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-bold tracking-tight text-slate-900">
            ${spendingStats.thisWeek.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
          <div
            className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
              spendingStats.percentChange === 0 && spendingStats.isHigher
                ? 'bg-slate-100 text-slate-500'
                : spendingStats.isHigher
                  ? 'bg-rose-100 text-rose-600'
                  : 'bg-emerald-100 text-emerald-600'
            }`}
          >
            {spendingStats.percentChange === 0 && spendingStats.isHigher ? (
              <span className="font-medium">No prior data</span>
            ) : (
              <>
                {spendingStats.isHigher ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                <span>{Math.abs(spendingStats.percentChange).toFixed(0)}%</span>
                <span className="opacity-60 font-medium">vs last week</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Recent Activity</h3>
        <div className="space-y-1">
          {recentTransactions.map(tx => (
            <div key={tx.id} className="flex items-center justify-between py-3 px-2 hover:bg-slate-50/80 rounded-xl transition-colors">
              <div className="flex items-center gap-3">
                 <div className="w-10 h-10 rounded-full bg-white border border-slate-100 flex items-center justify-center text-slate-400 shrink-0 shadow-sm">
                    <Receipt size={16} />
                 </div>
                 <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate max-w-[140px]">{tx.merchant}</p>
                    <p className="text-xxs text-slate-400 font-medium">{formatDistanceToNow(parseISO(tx.date), { addSuffix: true })}</p>
                 </div>
              </div>
              <span className="font-mono font-bold text-slate-900 text-sm">
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
