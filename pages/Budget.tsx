import React, { Suspense, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import BudgetCalendar from '@/components/budget/BudgetCalendar';
import SubscriptionsView from '@/components/budget/SubscriptionsView';
import BudgetBuckets from '@/components/budget/BudgetBuckets';
import BudgetAccounts from '@/components/budget/BudgetAccounts';
import TransactionMasterList from '@/components/budget/TransactionMasterList';
import MoneyOverview from '@/components/budget/MoneyOverview';
import SettleUpView from '@/components/transactions/SettleUpView';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { TabSubViewMenu } from '@/components/ui/TabSubViewMenu';
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
// 2026-07 critique P2), three of which pair two views chosen from a popover
// menu anchored under the tab itself (TabSubViewMenu): tapping a multi-view
// tab opens its menu, picking an item navigates. ONE state value holds the
// full location: the six legacy view keys stay valid and select their group's
// tab WITH the right segment, so every existing
// `navigate('/budget', { state: { tab: 'trends' } })` deep-link keeps working
// unchanged (deep-links never open the menu — it opens only from user taps).
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

type MoneyGroup = Exclude<TopTab, 'overview'>;

const isMoneyGroup = (value: string): value is MoneyGroup =>
  value === 'activity' || value === 'planned' || value === 'balances';

// Sub-view menu options per multi-view group. The labels double as the active
// trigger's text — the tab reads as the CURRENT sub-view ("Transactions ▾"),
// not the group name, once its group is selected.
const GROUP_OPTIONS: Record<MoneyGroup, { value: MoneyTabValue; label: string }[]> = {
  activity: [
    { value: 'transactions', label: 'Transactions' },
    { value: 'trends', label: 'Trends' },
  ],
  planned: [
    { value: 'calendar', label: 'Calendar' },
    { value: 'subscriptions', label: 'Subscriptions' },
  ],
  balances: [
    { value: 'buckets', label: 'Buckets' },
    { value: 'accounts', label: 'Accounts' },
  ],
};

/** Inactive-trigger label per group (also the caret-menu's fallback label). */
const GROUP_LABELS: Record<MoneyGroup, string> = {
  activity: 'Activity',
  planned: 'Planned',
  // Label only — the legacy 'balances' view/tab key is load-bearing
  // (deep-links, topTabOf, DEFAULT_SEGMENT, persisted state) and must not
  // change. "Budget" replaces the old "Balances" label, which promised literal
  // account balances but actually opens on Buckets (2026-07 audit P3).
  balances: 'Budget',
};

/** Accessible name for each group's sub-view menu. */
const GROUP_MENU_NAMES: Record<MoneyGroup, string> = {
  activity: 'Activity view',
  planned: 'Planned view',
  balances: 'Budget view',
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
  // ('trends', 'buckets', …) — the Tabs bar renders its top-level group (the
  // active trigger's label showing the specific view) and the panel renders
  // that view's content.
  const [activeView, setActiveView] = useDeepLinkTab('overview', MONEY_TABS);
  const activeTab = topTabOf(activeView);
  // Which multi-view tab's sub-view menu is open (null = none). Opened only by
  // taps on a group trigger — never by deep-links or keyboard arrow roving.
  const [openMenu, setOpenMenu] = useState<MoneyGroup | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Reached only by single-view taps (Overview) and the tablist's arrow-key
  // activation (taps on multi-view triggers are intercepted in capture phase
  // below, before the trigger's onClick can change the Tabs value) — keyboard
  // selection-follows-focus keeps its existing land-on-default behavior.
  const selectTab = (value: string) => {
    // Defensive invariant: a tab change (however triggered — keyboard roving
    // or a future programmatic onValueChange) always dismisses any open menu,
    // so a stale group's menu can never float over the newly-active tab.
    setOpenMenu(null);
    const tab = topTabOf(value);
    setActiveView(tab === 'overview' ? 'overview' : DEFAULT_SEGMENT[tab]);
  };
  // Tapping (or Enter/Space-ing — buttons synthesize click) a multi-view
  // trigger toggles its sub-view menu WITHOUT changing the selected tab;
  // navigation happens only when a menu item is picked. stopPropagation in
  // the capture phase keeps the event from ever reaching the trigger's own
  // onClick. While the menu is open its backdrop covers the tab bar, so a
  // re-tap lands there and closes (the toggle's other half).
  const handleTabBarClickCapture = (e: React.MouseEvent) => {
    const value = (e.target as HTMLElement)
      .closest('[data-tabs-value]')
      ?.getAttribute('data-tabs-value');
    if (value && isMoneyGroup(value)) {
      e.stopPropagation();
      setOpenMenu((prev) => (prev === value ? null : value));
    }
  };
  const segmentOf = (tab: Exclude<TopTab, 'overview'>): MoneyTabValue =>
    topTabOf(activeView) === tab && activeView !== tab ? (activeView as MoneyTabValue) : DEFAULT_SEGMENT[tab];
  // Multi-view trigger content: the CURRENT sub-view name while its group is
  // active, the group name otherwise — always with the small caret that
  // signals "this tab opens a menu". The caret is aria-hidden, so the
  // inactive accessible name stays the plain group name (e2e contract).
  const groupTrigger = (group: MoneyGroup) => (
    <>
      {activeTab === group
        ? (GROUP_OPTIONS[group].find((o) => o.value === segmentOf(group))?.label ?? GROUP_LABELS[group])
        : GROUP_LABELS[group]}
      <ChevronDown size={12} aria-hidden="true" className="-ml-1.5 opacity-70" />
    </>
  );
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
              screen at 375px (was 7 tabs with two off-screen). text-[13px] +
              px-1.5 (vs the base text-sm/px-3) buy the room the widest
              sub-view label ("Transactions ▾") + carets need at that width —
              px is only each trigger's MINIMUM (they `grow` to fill the
              trough), so the resting look is unchanged. The relative wrapper is the
              anchor container for TabSubViewMenu; the capture handler
              intercepts multi-view taps before Tabs sees them. */}
          <div ref={tabBarRef} className="relative mb-6" onClickCapture={handleTabBarClickCapture}>
            <TabsList>
              <TabsTrigger value="overview" className="text-[13px] px-1.5">
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="text-[13px] px-1.5"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'activity'}
              >
                {groupTrigger('activity')}
              </TabsTrigger>
              <TabsTrigger
                value="planned"
                className="text-[13px] px-1.5"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'planned'}
              >
                {groupTrigger('planned')}
              </TabsTrigger>
              <TabsTrigger
                value="balances"
                className="text-[13px] px-1.5"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'balances'}
              >
                {groupTrigger('balances')}
              </TabsTrigger>
            </TabsList>
            {openMenu && (
              <TabSubViewMenu
                isOpen
                onClose={() => setOpenMenu(null)}
                options={GROUP_OPTIONS[openMenu]}
                value={segmentOf(openMenu)}
                onSelect={setActiveView}
                name={GROUP_MENU_NAMES[openMenu]}
                anchorValue={openMenu}
                anchorRef={tabBarRef}
              />
            )}
          </div>

          {/* View container */}
          <div>
            <TabsContent value="overview">
              <MoneyOverview />
            </TabsContent>
            {/* No in-panel view chooser: the sub-view lives in the tab itself
                (tap the tab → TabSubViewMenu popover), so each panel renders
                its current segment directly. */}
            <TabsContent value="activity">
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
            </TabsContent>
            <TabsContent value="planned">
              {segmentOf('planned') === 'calendar' ? <BudgetCalendar /> : <SubscriptionsView />}
            </TabsContent>
            <TabsContent value="balances">
              {segmentOf('balances') === 'buckets' ? (
                <BudgetBuckets />
              ) : (
                <div className="space-y-6">
                  <BudgetAccounts />
                  <SettleUpView />
                </div>
              )}
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;
