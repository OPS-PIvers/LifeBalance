import React, { useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { PieChart, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ProgressBar } from '../ui/ProgressBar';

export const CategorySpendWidget: React.FC = () => {
  const { transactions } = useHousehold();

  const categoryStats = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const breakdown: Record<string, number> = {};
    let totalSpent = 0;

    transactions.forEach(tx => {
      // Exclude income and pending
      if (tx.category === 'Income' || tx.status === 'pending_review') return;

      // Filter for current month
      const date = parseISO(tx.date);
      if (!isWithinInterval(date, { start: monthStart, end: monthEnd })) return;

      const cat = tx.category || 'Uncategorized';
      breakdown[cat] = (breakdown[cat] || 0) + tx.amount;
      totalSpent += tx.amount;
    });

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

    return { totalSpent, displayItems };
  }, [transactions]);

  if (categoryStats.totalSpent === 0) return null;

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

      <div className="space-y-4">
        {categoryStats.displayItems.map((item, idx) => (
          <div key={item.name} className="space-y-2">
            <div className="flex justify-between text-xs font-bold text-slate-700">
              <span>{item.name}</span>
              <span className="font-mono text-slate-900">${item.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
            </div>
            <ProgressBar
              value={item.percentage}
              size="sm"
              trackColorClass="bg-slate-100"
              colorClass={
                idx === 0 ? 'bg-purple-500' :
                idx === 1 ? 'bg-purple-400' :
                idx === 2 ? 'bg-purple-300' : 'bg-slate-300'
              }
              aria-label={`Spending on ${item.name}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
