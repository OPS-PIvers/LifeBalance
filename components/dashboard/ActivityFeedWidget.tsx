import React, { useMemo } from 'react';
import { useFinance, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Receipt, CheckSquare } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

interface ActivityItem {
  id: string;
  type: 'transaction' | 'todo';
  title: string;
  subtitle: string;
  timestamp: Date;
  amount?: number;
}

export const ActivityFeedWidget: React.FC = () => {
  const { transactions } = useFinance();
  const { todos } = useTodos();
  const fmt = useFormatCurrency();

  const recentActivity = useMemo(() => {
    const transactionActivities: ActivityItem[] = transactions
      .filter(tx => tx.status === 'verified' && tx.category !== 'Income')
      .map(tx => ({
        id: tx.id,
        type: 'transaction',
        title: tx.merchant,
        subtitle: tx.category,
        timestamp: parseISO(tx.createdAt || tx.date),
        amount: tx.amount,
      }));

    const todoActivities: ActivityItem[] = todos
      .filter(todo => todo.isCompleted && todo.completedAt)
      .map(todo => ({
        id: todo.id,
        type: 'todo',
        title: todo.text,
        subtitle: 'Task completed',
        timestamp: parseISO(todo.completedAt!),
      }));

    return [...transactionActivities, ...todoActivities]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);
  }, [transactions, todos]);

  if (recentActivity.length === 0) return null;

  return (
    <Section title="Recent activity">
      <SurfaceList>
        {recentActivity.map(activity => (
          <Row key={`${activity.type}-${activity.id}`} className="justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                activity.type === 'transaction'
                  ? 'bg-accent-50 text-accent-700 dark:bg-accent-800/40 dark:text-accent-200'
                  : 'bg-money-bgPos text-money-pos dark:bg-money-pos/15 dark:text-money-pos'
              }`}>
                {activity.type === 'transaction' ? <Receipt size={16} /> : <CheckSquare size={16} />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate max-w-[150px] md:max-w-[220px]">
                  {activity.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xxs font-medium text-brand-400 dark:text-brand-500 truncate max-w-[100px]">{activity.subtitle}</p>
                  <span className="w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                  <p className="text-xxs text-brand-400 dark:text-brand-500 font-medium">
                    {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                  </p>
                </div>
              </div>
            </div>
            {activity.type === 'transaction' && activity.amount !== undefined && (
              <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50 text-sm shrink-0">
                {fmt(activity.amount, { decimals: 0 })}
              </span>
            )}
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
};
