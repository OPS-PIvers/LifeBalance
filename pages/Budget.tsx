import React, { Suspense, useEffect } from 'react';
import BudgetCalendar from '@/components/budget/BudgetCalendar';
import SubscriptionsView from '@/components/budget/SubscriptionsView';
import BudgetBuckets from '@/components/budget/BudgetBuckets';
import BudgetAccounts from '@/components/budget/BudgetAccounts';
import TransactionMasterList from '@/components/budget/TransactionMasterList';
import MoneyOverview from '@/components/budget/MoneyOverview';
import SettleUpView from '@/components/transactions/SettleUpView';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { ViewSwitcher } from '@/components/ui/ViewSwitcher';
import PageHeader from '@/components/ui/PageHeader';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useDeepLinkTab } from '@/hooks/useDeepLinkTab';
import { useDeepLinkHighlight } from '@/hooks/useDeepLinkHighlight';
import { preloadOnIdle } from '@/utils/preloadOnIdle';

// recharts is heavy — lazy-load the Trends chart body so it only enters the
// bundle when the Trends tab is actually opened (keeps the Money page boot lean).
// Named loader so React.lazy and the idle-preload share one dynamic import.
const loadBudgetTrends = () => import('@/components/budget/BudgetTrends');
const BudgetTrends = React.lazy(loadBudgetTrends);

// Money's IA is 4 top-level tabs (the old 7 overflowed the phone viewport —
// 2026-07 critique P2), three of which pair two views behind an inline
// view switcher in the content header. ONE state value holds the full
// location: the six legacy
// view keys stay valid and select their group's tab WITH the right segment,
// so every existing `navigate('/budget', { state: { tab: 'trends' } })`
// deep-link keeps working unchanged.
const MONEY_TABS = [
  'overview',
  // Activity group ('activity' = its default segment)
  'activity', 'transactions', 'trends',
  // Planned group
  'planned', 'calendar', 'subscriptions',
  // Balances group
  'balances', 'buckets', 'accounts',
] as const;

type MoneyTabValue = (typeof MONEY_TABS)[number];
type TopTab = 'overview' | 'activity' | 'planned' | 'balances';

/** Collapse any tab value (incl. legacy view keys) to its top-level tab. */
const topTabOf = (value: string): TopTab => {
  switch (value) {
    case 'transactions':
    case 'trends':
    case 'activity':
      return 'activity';
    case 'calendar':
    case 'subscriptions':
    case 'planned':
      return 'planned';
    case 'buckets':
    case 'accounts':
    case 'balances':
      return 'balances';
    default:
      return 'overview';
  }
};

/** The segment each group shows when entered via its top-level trigger. */
const DEFAULT_SEGMENT: Record<Exclude<TopTab, 'overview'>, MoneyTabValue> = {
  activity: 'transactions',
  planned: 'calendar',
  balances: 'buckets',
};

const BudgetSkeleton: React.FC = () => (
  <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading money…</span>

    {/* Editorial title placeholder */}
    <div className="px-5 pt-5 pb-4">
      <Skeleton className="h-6 w-32 rounded-card" />
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
  // deep-link straight to a view. `activeView` may be a legacy view key
  // ('trends', 'buckets', …) — the Tabs bar renders its top-level group and
  // the group's inline ViewSwitcher renders the specific view.
  const [activeView, setActiveView] = useDeepLinkTab('overview', MONEY_TABS);
  const activeTab = topTabOf(activeView);
  // Re-clicking the active group tab resets its segment to the default
  // (intentional — "tap the active tab to get back to its main view").
  const selectTab = (value: string) => {
    const tab = topTabOf(value);
    setActiveView(tab === 'overview' ? 'overview' : DEFAULT_SEGMENT[tab]);
  };
  const segmentOf = (tab: Exclude<TopTab, 'overview'>): MoneyTabValue =>
    topTabOf(activeView) === tab && activeView !== tab ? (activeView as MoneyTabValue) : DEFAULT_SEGMENT[tab];
  // Global search deep-link (v1.1): scroll-to + briefly flash the specific
  // transaction row selected in SearchOverlay, on top of the tab-level jump.
  const highlightTransactionId = useDeepLinkHighlight();

  // Warm the heavy recharts/Trends chunk during browser idle once the Money
  // page is open, so switching to the Trends tab is instant — without competing
  // with app boot (the chunk stays off the eager modulepreload path).
  useEffect(() => preloadOnIdle(loadBudgetTrends), []);

  if (isLoading) {
    return <BudgetSkeleton />;
  }

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe">
      <PageHeader title="Money" subtitle="Your accounts, bills, and spending." />

      <Tabs value={activeTab} onValueChange={selectTab}>
        <div className="px-4">
          {/* Sub-navigation — 4 top-level groups so every destination is on
              screen at 375px (was 7 tabs with two off-screen). */}
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="planned">Planned</TabsTrigger>
            {/* Label only — the legacy 'balances' view/tab key is load-bearing
                (deep-links, topTabOf, DEFAULT_SEGMENT, persisted state) and
                must not change. "Budget" replaces the old "Balances" label,
                which promised literal account balances but actually opens on
                Buckets (budget categories, not balances) — a naming mismatch
                (2026-07 audit P3). Matches the Activity/Planned pattern of an
                umbrella noun over the group's two segments. */}
            <TabsTrigger value="balances">Budget</TabsTrigger>
          </TabsList>

          {/* View container */}
          <div>
            <TabsContent value="overview">
              <MoneyOverview />
            </TabsContent>
            <TabsContent value="activity">
              <div className="space-y-4">
                {/* Content header: the sub-view dropdown IS the panel's title
                    (GitHub-mobile pattern) — one tab row above, the view choice
                    reads as part of the content, not a second nav tier. */}
                <ViewSwitcher
                  name="Activity view"
                  options={[
                    { value: 'transactions', label: 'Transactions' },
                    { value: 'trends', label: 'Trends' },
                  ]}
                  value={segmentOf('activity')}
                  onChange={setActiveView}
                />
                {segmentOf('activity') === 'transactions' ? (
                  <TransactionMasterList highlightId={highlightTransactionId} />
                ) : (
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
                )}
              </div>
            </TabsContent>
            <TabsContent value="planned">
              <div className="space-y-4">
                <ViewSwitcher
                  name="Planned view"
                  options={[
                    { value: 'calendar', label: 'Calendar' },
                    { value: 'subscriptions', label: 'Subscriptions' },
                  ]}
                  value={segmentOf('planned')}
                  onChange={setActiveView}
                />
                {segmentOf('planned') === 'calendar' ? <BudgetCalendar /> : <SubscriptionsView />}
              </div>
            </TabsContent>
            <TabsContent value="balances">
              <div className="space-y-4">
                <ViewSwitcher
                  name="Balances view"
                  options={[
                    { value: 'buckets', label: 'Buckets' },
                    { value: 'accounts', label: 'Accounts' },
                  ]}
                  value={segmentOf('balances')}
                  onChange={setActiveView}
                />
                {segmentOf('balances') === 'buckets' ? (
                  <BudgetBuckets />
                ) : (
                  <div className="space-y-6">
                    <BudgetAccounts />
                    <SettleUpView />
                  </div>
                )}
              </div>
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;
