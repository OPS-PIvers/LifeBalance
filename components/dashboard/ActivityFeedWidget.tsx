import React, { useMemo } from 'react';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useDashboardTransactionStats } from '@/hooks/useDashboardTransactionStats';
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

export const ActivityFeedWidget: React.FC = React.memo(() => {
  const { transactionActivityRows } = useDashboardTransactionStats();
  const { todos } = useTodos();
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();
  const fmt = useFormatCurrency();

  // Plan 090 (graceful degradation): transaction rows are money, completed-todo
  // rows follow the Plan→To-Dos cascade. Drop the disabled domain's rows; the
  // widget self-hides below if nothing is left to show.
  const showMoney = isModuleEnabled('money');
  const showTodos = isPlanTabVisible('todos');

  const recentActivity = useMemo(() => {
    // Transaction rows (verified, non-income) come pre-mapped from the shared
    // single-pass hook; the money gate + final merge/sort/slice stay local since
    // the sort interleaves transactions with completed to-dos.
    const transactionActivities: ActivityItem[] = showMoney ? transactionActivityRows : [];

    const todoActivities: ActivityItem[] = showTodos
      ? todos
          .filter(todo => todo.isCompleted && todo.completedAt)
          .map(todo => ({
            id: todo.id,
            type: 'todo',
            title: todo.text,
            subtitle: 'Task completed',
            timestamp: parseISO(todo.completedAt!),
          }))
      : [];

    return [...transactionActivities, ...todoActivities]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);
  }, [showMoney, showTodos, transactionActivityRows, todos]);

  if (recentActivity.length === 0) return null;

  return (
    <Section title="Recent activity">
      <SurfaceList>
        {recentActivity.map(activity => (
          <Row key={`${activity.type}-${activity.id}`} className="justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-card flex items-center justify-center shrink-0 ${
                activity.type === 'transaction'
                  ? 'bg-accent-50 text-accent-700 dark:bg-accent-800/40 dark:text-accent-200'
                  : 'bg-money-bgPos text-money-pos dark:bg-money-pos/15 dark:text-money-posDark'
              }`}>
                {activity.type === 'transaction' ? <Receipt size={16} /> : <CheckSquare size={16} />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate max-w-[150px] md:max-w-[220px]">
                  {activity.title}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <p className="text-xxs font-medium text-brand-400 dark:text-brand-450 truncate max-w-[100px]">{activity.subtitle}</p>
                  <span className="w-1 h-1 rounded-full bg-brand-300 dark:bg-brand-600" />
                  <p className="text-xxs text-brand-400 dark:text-brand-450 font-medium">
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
});

ActivityFeedWidget.displayName = 'ActivityFeedWidget';
