import { useMemo } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { HouseholdMember } from '@/types/schema';
import { isAfter, subDays, parseISO } from 'date-fns';

export interface ActivityItem {
  id: string;
  type: 'transaction' | 'todo' | 'shopping' | 'meal';
  title: string;
  subtitle?: string;
  user?: HouseholdMember;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Helper to safely extract Date from various formats (ISO string, Firestore Timestamp)
const getDate = (val: string | object | undefined): Date | null => {
  if (!val) return null;
  if (typeof val === 'string') return parseISO(val);
  // Check for Firestore Timestamp-like object (seconds, nanoseconds) or toDate() method
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ('toDate' in val && typeof (val as any).toDate === 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (val as any).toDate();
  }
  // Fallback for raw seconds (if any)
  if ('seconds' in val) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new Date((val as any).seconds * 1000);
  }
  return null;
};

export const useRecentActivity = () => {
  const { transactions, shoppingList, todos, mealPlan, members } = useHousehold();

  const activities = useMemo(() => {
    const items: ActivityItem[] = [];
    const now = new Date();
    const sevenDaysAgo = subDays(now, 7);

    // Helper to find user
    const getUser = (uid?: string) => members.find(m => m.uid === uid);

    // 1. Transactions (Added recently)
    // Note: Transaction date is user-entered date, createdAt is when it was added.
    // We prefer createdAt for "Activity Feed", but fallback to date.
    transactions.forEach((tx) => {
      const createdAt = getDate(tx.createdAt);
      // Fallback: use tx.date (string YYYY-MM-DD) as timestamp if createdAt missing
      const timestamp = createdAt || parseISO(tx.date);

      if (timestamp && isAfter(timestamp, sevenDaysAgo)) {
        items.push({
          id: tx.id,
          type: 'transaction',
          title: tx.merchant,
          subtitle: `$${tx.amount.toFixed(2)}`,
          user: getUser(tx.createdBy),
          timestamp,
          metadata: { category: tx.category }
        });
      }
    });

    // 2. Shopping List (Added recently)
    shoppingList.forEach((item) => {
      const timestamp = getDate(item.createdAt);
      if (timestamp && isAfter(timestamp, sevenDaysAgo)) {
        items.push({
          id: item.id,
          type: 'shopping',
          title: item.name,
          subtitle: item.quantity ? `Qty: ${item.quantity}` : 'Added to list',
          timestamp,
          // ShoppingItem doesn't store createdBy in Context actions currently
        });
      }
    });

    // 3. ToDos (Completed recently or Added recently)
    todos.forEach((todo) => {
      // Completed
      if (todo.isCompleted && todo.completedAt) {
        const completedAt = getDate(todo.completedAt);
        if (completedAt && isAfter(completedAt, sevenDaysAgo)) {
          items.push({
            id: `completed-${todo.id}`,
            type: 'todo',
            title: todo.text,
            subtitle: 'Completed',
            user: getUser(todo.assignedTo || todo.createdBy), // assignedTo is better context for completion
            timestamp: completedAt,
          });
        }
      } else {
        // Created
        const createdAt = getDate(todo.createdAt);
        if (createdAt && isAfter(createdAt, sevenDaysAgo)) {
           items.push({
            id: `created-${todo.id}`,
            type: 'todo',
            title: todo.text,
            subtitle: 'Created',
            user: getUser(todo.createdBy),
            timestamp: createdAt,
          });
        }
      }
    });

    // 4. Meal Plan (Added recently)
    mealPlan.forEach((plan) => {
      const createdAt = getDate(plan.createdAt);
      if (createdAt && isAfter(createdAt, sevenDaysAgo)) {
         items.push({
          id: plan.id,
          type: 'meal',
          title: plan.mealName,
          subtitle: `Planned for ${plan.date}`,
          timestamp: createdAt,
        });
      }
    });

    // Sort Descending
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20);

  }, [transactions, shoppingList, todos, mealPlan, members]);

  return { activities };
};
