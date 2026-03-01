import React, { useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfMonth, endOfMonth, isWithinInterval, parseISO, subMonths, isBefore, isEqual } from 'date-fns';
import { PieChart, ArrowRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';

export const CategorySpendWidget: React.FC = () => {
  const { transactions } = useHousehold();

  const categoryStats = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // Previous month (Month-To-Date calculation)
    const prevMonthStart = subMonths(monthStart, 1);
    const prevMonthNow = subMonths(now, 1);

    const breakdown: Record<string, number> = {};
    let totalSpent = 0;
    let prevMonthTotalSpentMTD = 0;

    transactions.forEach(tx => {
      // Exclude income and pending
      if (tx.category === 'Income' || tx.status === 'pending_review') return;

      const date = parseISO(tx.date);

      // Filter for current month
      if (isWithinInterval(date, { start: monthStart, end: monthEnd })) {
        const cat = tx.category || 'Uncategorized';
        breakdown[cat] = (breakdown[cat] || 0) + tx.amount;
        totalSpent += tx.amount;
      }

      // Calculate previous Month-to-Date
      if (isWithinInterval(date, { start: prevMonthStart, end: prevMonthNow }) || isEqual(date, prevMonthStart) || isEqual(date, prevMonthNow)) {
        prevMonthTotalSpentMTD += tx.amount;
      }
    });

    // Calculate trend
    let trendPercentage = 0;
    let trendDirection: 'up' | 'down' | 'flat' = 'flat';

    if (prevMonthTotalSpentMTD > 0) {
      const difference = totalSpent - prevMonthTotalSpentMTD;
      trendPercentage = Math.abs((difference / prevMonthTotalSpentMTD) * 100);

      if (difference > 0) {
        trendDirection = 'up';
      } else if (difference < 0) {
        trendDirection = 'down';
      }
    } else if (totalSpent > 0 && prevMonthTotalSpentMTD === 0) {
       trendPercentage = 100;
       trendDirection = 'up';
    }

    // Convert to array and sort
    const sorted = Object.entries(breakdown)
      .map(([name, amount]) => ({ name, amount, percentage: (amount / totalSpent) * 100 }))
      .sort((a, b) => b.amount - a.amount);

    // Top 3 + Others
    const top3 = sorted.slice(0, 3);
    const othersAmount = sorted.slice(3).reduce((sum, item) => sum + item.amount, 0);
    const othersPercentage = sorted.slice(3).reduce((sum, item) => sum + item.percentage, 0);

    const displayItems = [...top3];
    if (othersAmount > 0) {
      displayItems.push({ name: 'Others', amount: othersAmount, percentage: othersPercentage });
    }

    return { totalSpent, displayItems, trendPercentage, trendDirection };
  }, [transactions]);

  if (categoryStats.totalSpent === 0) return null;

  return (
    <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <div className="flex flex-col">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <div className="p-1.5 bg-purple-100 text-purple-600 rounded-lg">
               <PieChart size={14} />
            </div>
            Top Spending (Month)
          </h2>
          {categoryStats.trendDirection !== 'flat' && (
             <div className="flex items-center gap-1 mt-1.5 ml-8">
               <span className={`flex items-center text-xs font-bold px-1.5 py-0.5 rounded-md ${
                  categoryStats.trendDirection === 'up'
                  ? 'bg-rose-50 text-rose-600 border border-rose-100'
                  : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
               }`}>
                  {categoryStats.trendDirection === 'up' ? <TrendingUp size={10} className="mr-1" /> : <TrendingDown size={10} className="mr-1" />}
                  {categoryStats.trendPercentage.toFixed(0)}%
               </span>
               <span className="text-xs text-slate-400 font-medium">vs last month</span>
             </div>
          )}
        </div>
        <Link
          to="/budget"
          className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
        >
          Details <ArrowRight size={12} />
        </Link>
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
