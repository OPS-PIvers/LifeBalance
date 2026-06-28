import React, { Suspense } from 'react';
import BudgetCalendar from '@/components/budget/BudgetCalendar';
import BudgetBuckets from '@/components/budget/BudgetBuckets';
import BudgetAccounts from '@/components/budget/BudgetAccounts';
import TransactionMasterList from '@/components/budget/TransactionMasterList';
import MoneyOverview from '@/components/budget/MoneyOverview';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useDeepLinkTab } from '@/hooks/useDeepLinkTab';

// recharts is heavy — lazy-load the Trends chart body so it only enters the
// bundle when the Trends tab is actually opened (keeps the Money page boot lean).
const BudgetTrends = React.lazy(() => import('@/components/budget/BudgetTrends'));

// Allowed Money sub-tabs. Module-level so the array identity is stable and
// other screens can deep-link via `navigate('/budget', { state: { tab } })`.
const MONEY_TABS = ['overview', 'calendar', 'buckets', 'accounts', 'transactions', 'trends'] as const;

const BudgetSkeleton: React.FC = () => (
  <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-32" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading money…</span>

    {/* Editorial title placeholder */}
    <div className="px-5 pt-8 pb-6">
      <Skeleton className="h-8 w-32 rounded-card" />
    </div>

    <div className="px-4 space-y-6">
      {/* Tab bar placeholder */}
      <Skeleton className="h-11 w-full rounded-xl" />

      {/* Hero / summary placeholder — mimics the Safe-to-Spend detail */}
      <div className="surface-section p-5">
        <Skeleton className="h-4 w-1/3 mb-4" />
        <SkeletonText lines={2} />
      </div>

      {/* Grouped hairline rows — mimics buckets / transactions */}
      <div className="surface-section overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-4 border-t border-brand-200 dark:border-brand-700 first:border-t-0"
          >
            <Skeleton className="h-9 w-9 rounded-card shrink-0" />
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
  // Controlled so the toolbar Safe-to-Spend glance / Home Analytics button can
  // deep-link straight to a tab (Overview / Trends) instead of opening a modal.
  const [activeTab, setActiveTab] = useDeepLinkTab('overview', MONEY_TABS);

  if (isLoading) {
    return <BudgetSkeleton />;
  }

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-32">
      {/* Editorial page title */}
      <div className="px-5 pt-8 pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">
          Money
        </h1>
        <p className="mt-1 text-sm text-brand-500 dark:text-brand-400 font-medium">
          Your accounts, bills, and spending.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="px-4">
          {/* Sub-navigation — unified ui/Tabs */}
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="buckets">Buckets</TabsTrigger>
            <TabsTrigger value="accounts">Accounts</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
          </TabsList>

          {/* View container */}
          <div>
            <TabsContent value="overview">
              <MoneyOverview />
            </TabsContent>
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
            <TabsContent value="trends">
              <Suspense
                fallback={
                  <div className="space-y-6" aria-busy="true">
                    <Skeleton className="h-80 w-full rounded-2xl" />
                    <Skeleton className="h-56 w-full rounded-2xl" />
                  </div>
                }
              >
                <BudgetTrends />
              </Suspense>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;
