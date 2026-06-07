import React, { useMemo } from 'react';
import { useFinance, useTodos } from '../../contexts/FirebaseHouseholdContext';
import { Activity, Receipt, CheckSquare } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';

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

  const recentActivity = useMemo(() => {
    const transactionActivities: ActivityItem[] = transactions
      .filter(tx => tx.status === 'verified' && tx.category !== 'Income')
      .map(tx => ({
        id: tx.id,
        type: 'transaction',
        title: tx.merchant,
        subtitle: tx.category,
        timestamp: parseISO(tx.createdAt || tx.date), // Use createdAt if available, fallback to date
        amount: tx.amount,
      }));

    const todoActivities: ActivityItem[] = todos
      .filter(todo => todo.isCompleted && todo.completedAt)
      .map(todo => ({
        id: todo.id,
        type: 'todo',
        title: todo.text,
        subtitle: 'Task Completed',
        timestamp: parseISO(todo.completedAt!),
      }));

    return [...transactionActivities, ...todoActivities]
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5); // Take top 5
  }, [transactions, todos]);

  if (recentActivity.length === 0) return null;

  return (
    <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <div className="p-1.5 bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 rounded-lg">
             <Activity size={14} />
          </div>
          Recent Activity
        </h2>
      </div>

      <div className="space-y-1">
        {recentActivity.map(activity => (
          <div key={`${activity.type}-${activity.id}`} className="flex items-center justify-between py-3 px-2 hover:bg-slate-50/80 dark:hover:bg-slate-700/50 rounded-xl transition-colors">
            <div className="flex items-center gap-3">
               <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
                 activity.type === 'transaction'
                  ? 'bg-blue-50 border border-blue-100 text-blue-600 dark:bg-blue-500/10 dark:border-blue-500/20'
                  : 'bg-emerald-50 border border-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:border-emerald-500/20'
               }`}>
                  {activity.type === 'transaction' ? <Receipt size={16} /> : <CheckSquare size={16} />}
               </div>
               <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate max-w-[140px] md:max-w-[200px]">{activity.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className="text-xxs font-medium text-slate-400 dark:text-slate-500 truncate max-w-[100px]">{activity.subtitle}</p>
                    <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <p className="text-xxs text-slate-400 dark:text-slate-500 font-medium">
                      {formatDistanceToNow(activity.timestamp, { addSuffix: true })}
                    </p>
                  </div>
               </div>
            </div>
            {activity.type === 'transaction' && activity.amount !== undefined && (
              <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                 ${activity.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
