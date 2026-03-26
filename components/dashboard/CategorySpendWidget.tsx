import React, { useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfMonth, isWithinInterval, parseISO, subMonths } from 'date-fns';
import { PieChart, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';

export const CategorySpendWidget: React.FC = () => {
  const { transactions } = useHousehold();

  const categoryStats = useMemo(() => {
    const now = new Date();
    // Current Month Range
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = now;

    // Last Month MTD Range
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthMTDEnd = subMonths(now, 1);

    const breakdown: Record<string, number> = {};
    let totalSpent = 0;
    let lastMonthTotalSpent = 0;

    transactions.forEach(tx => {
      // Exclude income and pending
      if (tx.category === 'Income' || tx.status === 'pending_review') return;

      const date = parseISO(tx.date);

      // Current Month Logic
      if (isWithinInterval(date, { start: currentMonthStart, end: currentMonthEnd })) {
        const cat = tx.category || 'Uncategorized';
        breakdown[cat] = (breakdown[cat] || 0) + tx.amount;
        totalSpent += tx.amount;
      }

      // Last Month MTD Logic
      if (isWithinInterval(date, { start: lastMonthStart, end: lastMonthMTDEnd })) {
        lastMonthTotalSpent += tx.amount;
      }
    });

    // Trend Calculation
    const diff = totalSpent - lastMonthTotalSpent;
    const percentChange = lastMonthTotalSpent > 0 ? (diff / lastMonthTotalSpent) * 100 : 0;
    const isHigher = diff >= 0;
    const hasPriorData = lastMonthTotalSpent > 0;

    // Convert to array and sort (Existing logic)
    const sorted = Object.entries(breakdown)
      .map(([name, amount]) => ({ name, amount, percentage: (amount / totalSpent) * 100 }))
      .sort((a, b) => b.amount - a.amount);

    // Top 3 + Others (Existing logic)
    const top3 = sorted.slice(0, 3);
    const othersAmount = sorted.slice(3).reduce((sum, item) => sum + item.amount, 0);
    const othersPercentage = sorted.slice(3).reduce((sum, item) => sum + item.percentage, 0);

    const displayItems = [...top3];
    if (othersAmount > 0) {
      displayItems.push({ name: 'Others', amount: othersAmount, percentage: othersPercentage });
    }

    return { totalSpent, displayItems, percentChange, isHigher, hasPriorData };
  }, [transactions]);

  if (categoryStats.totalSpent === 0 && !categoryStats.hasPriorData) return null;

  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          <div className="p-1.5 bg-purple-100 text-purple-600 rounded-lg">
             <PieChart size={14} />
          </div>
          Top Spending (Month)
        </h2>
        <Link
          to="/budget"
          className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
          Details <ArrowRight size={12} />
        </Link>
      </div>

      {/* New Summary Header */}
      <div className="mb-6 px-1">
        <p className="text-xs text-slate-500 font-medium mb-1">Total Spent</p>
        <div className="flex items-baseline gap-3">
          <p className="text-3xl font-bold tracking-tight text-slate-900">
            ${categoryStats.totalSpent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>

          <div
            className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${
              !categoryStats.hasPriorData
                ? 'bg-slate-100 text-slate-500'
                : categoryStats.isHigher
                  ? 'bg-rose-100 text-rose-600'
                  : 'bg-emerald-100 text-emerald-600'
            }`}
          >
            {!categoryStats.hasPriorData ? (
               <span className="font-medium">No prior data</span>
            ) : (
              <>
                {categoryStats.isHigher ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                <span>{Math.abs(categoryStats.percentChange).toFixed(0)}%</span>
                <span className="opacity-60 font-medium">vs last month</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {categoryStats.displayItems.map((item, idx) => (
          <div key={item.name} className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-700">
              <span>{item.name}</span>
              <span className="font-mono text-slate-900">${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
               <div
                 className={`h-full rounded-full transition-all duration-500 ${
                    idx === 0 ? 'bg-purple-500' :
                    idx === 1 ? 'bg-purple-400' :
                    idx === 2 ? 'bg-purple-300' : 'bg-slate-300'
                 }`}
                 style={{ width: `${item.percentage}%` }}
               />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
