import React, { useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { roundMoney, sumMoney } from '@/utils/money';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';

export const CategorySpendWidget: React.FC = () => {
  const { transactions } = useFinance();
  const fmt = useFormatCurrency();

  const categoryStats = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    const breakdown: Record<string, number> = {};
    let totalSpent = 0;

    transactions.forEach(tx => {
      if (tx.category === 'Income' || tx.status === 'pending_review') return;
      const date = parseISO(tx.date);
      if (!isWithinInterval(date, { start: monthStart, end: monthEnd })) return;

      const cat = tx.category || 'Uncategorized';
      breakdown[cat] = (breakdown[cat] || 0) + tx.amount;
      totalSpent += tx.amount;
    });

    totalSpent = roundMoney(totalSpent);

    const sorted = Object.entries(breakdown)
      .map(([name, amount]) => {
        const rounded = roundMoney(amount);
        return { name, amount: rounded, percentage: totalSpent > 0 ? (rounded / totalSpent) * 100 : 0 };
      })
      .sort((a, b) => b.amount - a.amount);

    const top3 = sorted.slice(0, 3);
    const rest = sorted.slice(3);
    const othersAmount = sumMoney(rest.map(item => item.amount));
    const othersPercentage = rest.reduce((sum, item) => sum + item.percentage, 0);

    const displayItems = [...top3];
    if (othersAmount > 0) {
      displayItems.push({ name: 'Others', amount: othersAmount, percentage: othersPercentage });
    }

    return { totalSpent, displayItems };
  }, [transactions]);

  if (categoryStats.totalSpent === 0) return null;

  // Ranked evergreen ramp — the money domain color, deepest for the top spend.
  const barColor = (idx: number) =>
    idx === 0 ? 'bg-accent-600' :
    idx === 1 ? 'bg-accent-500' :
    idx === 2 ? 'bg-accent-400' : 'bg-brand-300 dark:bg-brand-600';

  return (
    <Section
      title="Top spending this month"
      action={
        <Link
          to="/budget"
          className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 transition-colors"
        >
          Details <ArrowRight size={12} />
        </Link>
      }
    >
      <SurfaceList>
        {categoryStats.displayItems.map((item, idx) => (
          <Row key={item.name} className="flex-col items-stretch gap-2">
            <div className="flex justify-between text-xs font-semibold text-brand-700 dark:text-brand-200">
              <span>{item.name}</span>
              <span className="font-mono tabular-nums text-brand-900 dark:text-brand-50">{fmt(item.amount, { decimals: 0 })}</span>
            </div>
            <div className="h-1.5 bg-brand-100 dark:bg-brand-700 rounded-full overflow-hidden">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.percentage)}
                aria-label={`${item.name}: ${Math.round(item.percentage)}% of spending`}
                className={cn('h-full rounded-full transition-all duration-(--duration-slow) ease-(--ease-standard)', barColor(idx))}
                style={{ width: `${item.percentage}%` }}
              />
            </div>
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
};
