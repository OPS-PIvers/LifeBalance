
import React from 'react';
import BudgetCalendar from '@/components/budget/BudgetCalendar';
import BudgetBuckets from '@/components/budget/BudgetBuckets';
import BudgetAccounts from '@/components/budget/BudgetAccounts';
import TransactionMasterList from '@/components/budget/TransactionMasterList';
import BudgetHistory from '@/components/budget/BudgetHistory';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';

const BudgetSkeleton: React.FC = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-brand-900 pb-28 pt-6" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading budget…</span>
    <div className="px-4">
      {/* Tab bar placeholder */}
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 flex-1 rounded-xl" />
        ))}
      </div>

      {/* Summary row — mimics the calendar header / account balance row */}
      <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 mb-6">
        <Skeleton className="h-4 w-1/3 mb-4" />
        <div className="flex gap-4 mb-4">
          <Skeleton className="h-14 flex-1 rounded-2xl" />
          <Skeleton className="h-14 flex-1 rounded-2xl" />
          <Skeleton className="h-14 flex-1 rounded-2xl" />
        </div>
        <SkeletonText lines={2} />
      </div>

      {/* Two item rows — mimics budget buckets / transactions */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4"
          >
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-4 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

const Budget: React.FC = () => {
  const { isLoading } = useHouseholdCore();

  if (isLoading) {
    return <BudgetSkeleton />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-brand-900 pb-28 pt-6">
      <Tabs defaultValue="calendar">
        <div className="px-4">
          {/* Sub-Navigation */}
          <TabsList className="mb-6">
            <TabsTrigger value="calendar">
              Calendar
            </TabsTrigger>
            <TabsTrigger value="buckets">
              Buckets
            </TabsTrigger>
            <TabsTrigger value="accounts">
              Accounts
            </TabsTrigger>
            <TabsTrigger value="transactions">
              Transactions
            </TabsTrigger>
            <TabsTrigger value="history">
              History
            </TabsTrigger>
          </TabsList>

          {/* View Container */}
          <div>
            <TabsContent value="calendar">
              <BudgetCalendar />
            </TabsContent>
            <TabsContent value="buckets">
              <BudgetBuckets />
            </TabsContent>
            <TabsContent value="accounts">
              <BudgetAccounts />
            </TabsContent>
            <TabsContent value="transactions">
              <TransactionMasterList />
            </TabsContent>
            <TabsContent value="history">
              <BudgetHistory />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;
