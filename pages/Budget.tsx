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
import { tabValueAtPoint } from '@/components/ui/tabValueAtPoint';
import { SubViewHint } from '@/components/ui/SubViewHint';
import PageHeader from '@/components/ui/PageHeader';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import { useDeepLinkTab } from '@/hooks/useDeepLinkTab';
import { useDeepLinkHighlight } from '@/hooks/useDeepLinkHighlight';
import { usePageNavigation } from '@/hooks/usePageNavigation';
import { resolveActiveLocation, type VisibleGroup } from '@/utils/moduleVisibility';
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

// 2F.1: the group/leaf tree, the per-group menu options, the group labels
// (incl. "Budget" for the load-bearing legacy 'balances' key) and each group's
// default segment (= its FIRST leaf) all now come from the shared registry in
// utils/moduleVisibility.ts, filtered to what this household + member can see.
// Nothing about the IA changed — the constants simply stopped being duplicated
// here, so hiding a leaf removes it from the tab, the menu, and the panel in
// one place.

const BudgetSkeleton: React.FC = () => (
  <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe" aria-busy="true" aria-live="polite">
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
  // 2F.1 — the group/leaf tree this household + member can actually reach.
  const nav = usePageNavigation('money');
  // Controlled so the toolbar Safe-to-Spend glance / Home Analytics button can
  // deep-link straight to a view. `activeView` may be a legacy view key
  // ('trends', 'buckets', …) or a view since hidden — `resolveActiveLocation`
  // maps whatever it holds onto a { group, leaf } pair that is still visible.
  const [activeView, setActiveView] = useDeepLinkTab('overview', MONEY_TABS);
  const location = resolveActiveLocation(nav, activeView);
  const activeTab = location?.group ?? '';
  const activeLeaf = location?.leaf ?? '';
  // Which multi-view tab's sub-view menu is open (null = none). Opened only by
  // taps on a group trigger — never by deep-links or keyboard arrow roving.
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const groupOf = (key: string) => nav.groups.find((g) => g.key === key);
  // Guarded lookup: a group can vanish (member hides its last leaf) while its
  // menu is open, so the menu renders only while its group still exists.
  const openMenuGroup = openMenu ? groupOf(openMenu) : undefined;
  const hasMultiViewGroup = nav.groups.some((g) => g.leaves.length > 1);
  /**
   * COLLAPSE RULE (2F.1): a group with exactly one visible leaf navigates
   * straight there — no caret, no menu. Only a group that still pairs two or
   * more views opens a `TabSubViewMenu`.
   */
  const isMultiView = (key: string) => (groupOf(key)?.leaves.length ?? 0) > 1;
  // Reached only by single-view taps and the tablist's arrow-key activation
  // (taps on multi-view triggers are intercepted in capture phase below,
  // before the trigger's onClick can change the Tabs value) — keyboard
  // selection-follows-focus keeps its existing land-on-default behavior.
  const selectTab = (value: string) => {
    // Defensive invariant: a tab change (however triggered — keyboard roving
    // or a future programmatic onValueChange) always dismisses any open menu,
    // so a stale group's menu can never float over the newly-active tab.
    setOpenMenu(null);
    // Entering a group via its top trigger shows the group's first visible
    // leaf — the registry order is the default-segment order.
    const first = groupOf(value)?.leaves[0]?.key;
    if (first) setActiveView(first);
  };
  // Tapping (or Enter/Space-ing — buttons synthesize click) a multi-view
  // trigger toggles its sub-view menu WITHOUT changing the selected tab;
  // navigation happens only when a menu item is picked. stopPropagation in
  // the capture phase keeps the event from ever reaching the trigger's own
  // onClick. While the menu is open its backdrop covers the tab bar, so taps
  // arrive here with the backdrop as target — hit-testing recovers the
  // intended trigger so a tap on ANOTHER tab acts in one tap (switch menus,
  // or navigate for a single-view tab) instead of just dismissing; a re-tap
  // on the same tab still closes.
  const handleTabBarClickCapture = (e: React.MouseEvent) => {
    let value = (e.target as HTMLElement)
      .closest('[data-tabs-value]')
      ?.getAttribute('data-tabs-value');
    if (!value && openMenu) {
      value = tabValueAtPoint(tabBarRef.current, e.clientX, e.clientY) ?? undefined;
      if (value && !isMultiView(value)) {
        // Single-view tab under the backdrop: dismiss + navigate.
        e.stopPropagation();
        selectTab(value);
        return;
      }
    }
    if (value && isMultiView(value)) {
      e.stopPropagation();
      setOpenMenu((prev) => (prev === value ? null : value));
    }
  };
  /** The leaf a group's panel renders: the active one, else its first visible leaf. */
  const segmentOf = (key: string): string =>
    (activeTab === key ? activeLeaf : groupOf(key)?.leaves[0]?.key) ?? '';
  // Multi-view trigger content: the CURRENT sub-view name while its group is
  // active, the group name otherwise — always with the small caret that
  // signals "this tab opens a menu". The caret is aria-hidden, so the
  // inactive accessible name stays the plain group name (e2e contract).
  // A single-leaf group renders its own label with no caret: there is no menu.
  const groupTrigger = (group: VisibleGroup) => {
    if (!isMultiView(group.key)) return group.label;
    const current = group.leaves.find((l) => l.key === segmentOf(group.key));
    return (
      <>
        {activeTab === group.key ? (current?.label ?? group.label) : group.label}
        <ChevronDown size={12} aria-hidden="true" className="-ml-1.5" />
      </>
    );
  };
  // Global search deep-link (v1.1): scroll-to + briefly flash the specific
  // transaction row selected in SearchOverlay, on top of the tab-level jump.
  const highlightTransactionId = useDeepLinkHighlight();

  // Warm the heavy recharts/Trends chunk during browser idle once the Money
  // page is open, so switching to the Trends tab is instant — without competing
  // with app boot (the chunk stays off the eager modulepreload path).
  useEffect(() => preloadOnIdle(loadBudgetTrends), []);

  /** One leaf's content. The single place a Money view is mapped to its body. */
  const renderLeaf = (leaf: string) => {
    switch (leaf) {
      case 'overview':
        return <MoneyOverview />;
      case 'transactions':
        return <TransactionMasterList highlightId={highlightTransactionId} />;
      case 'trends':
        return (
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
        );
      case 'calendar':
        return <BudgetCalendar />;
      case 'subscriptions':
        return <SubscriptionsView />;
      case 'buckets':
        return <BudgetBuckets />;
      case 'accounts':
        return (
          <div className="space-y-6">
            <BudgetAccounts />
            <SettleUpView />
          </div>
        );
      default:
        return null;
    }
  };

  if (isLoading) {
    return <BudgetSkeleton />;
  }

  // No reachable view — `ModuleRoute` redirects this route away, so this is
  // only the frame between that decision and the redirect.
  if (!location) return null;

  // COLLAPSE RULE (2F.1) at the page level: exactly one reachable view means
  // there is nothing to switch between, so the tab strip and the coach hint
  // both go and the footer's Money item simply IS this view.
  if (nav.soleLeaf) {
    return (
      <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe">
        <PageHeader title="Money" subtitle="Your accounts, bills, and spending." />
        <div className="px-4 pt-4">{renderLeaf(nav.soleLeaf.key)}</div>
      </div>
    );
  }

  return (
    <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe">
      <PageHeader title="Money" subtitle="Your accounts, bills, and spending." />

      <Tabs value={activeTab} onValueChange={selectTab}>
        {/* Sub-navigation — STICKY strip (unified page-scroll model): pins at
            the top of MainLayout's single page scroller while content passes
            beneath, with the page background + bottom hairline matching
            ListsPage's tab strip exactly. 4 top-level groups so every
            destination is on screen at 375px (was 7 tabs with two off-screen).
            text-[13px] + px-1.5 (vs the base text-sm/px-3) buy the room the
            widest sub-view label ("Transactions ▾") + carets need at that
            width — px is only each trigger's MINIMUM (they `grow` to fill the
            trough), so the resting look is unchanged. The relative wrapper is
            the anchor container for TabSubViewMenu; the capture handler
            intercepts multi-view taps before Tabs sees them. */}
        <div className="px-4 pt-3 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
          <div ref={tabBarRef} className="relative" onClickCapture={handleTabBarClickCapture}>
            <TabsList equalWidth>
              {nav.groups.map((group) => {
                const multi = isMultiView(group.key);
                return (
                  <TabsTrigger
                    key={group.key}
                    value={group.key}
                    className="text-[13px] px-1.5"
                    {...(multi
                      ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': openMenu === group.key }
                      : {})}
                  >
                    {groupTrigger(group)}
                  </TabsTrigger>
                );
              })}
            </TabsList>
            {openMenu && openMenuGroup && (
              <TabSubViewMenu
                // Remount on group switch (tab-to-tab tap while open) so the
                // focus trap re-initializes onto the NEW menu's checked item
                // and the entrance animation replays under the new anchor.
                key={openMenu}
                isOpen
                onClose={() => setOpenMenu(null)}
                options={openMenuGroup.leaves.map((l) => ({ value: l.key, label: l.label }))}
                // Checked = "you are here": only when this menu's group is the
                // active tab. Previewing another group's menu (tab-to-tab tap)
                // checks nothing — its default segment isn't the current page.
                value={activeTab === openMenu ? segmentOf(openMenu) : undefined}
                onSelect={setActiveView}
                name={`${openMenuGroup.label} view`}
                anchorValue={openMenu}
                anchorRef={tabBarRef}
              />
            )}
          </div>
        </div>

        <div className="px-4 pt-4">
          {/* One-time coach hint for the tab-popover nav — first visit only;
              opening any tab menu, the ×, or navigating away latches it off
              for good (shared with the Habits page). Lives in the scrolling
              content column (not the sticky strip) so its dismissal never
              resizes the pinned strip. Suppressed once every remaining group
              is single-view: there is no menu left to coach about. */}
          {hasMultiViewGroup && (
            <SubViewHint menuOpened={openMenu !== null} className="mb-6" />
          )}

          {/* View container. No in-panel view chooser: the sub-view lives in
              the tab itself (tap the tab → TabSubViewMenu popover), so each
              panel renders its current segment directly. */}
          <div>
            {nav.groups.map((group) => (
              <TabsContent key={group.key} value={group.key}>
                {renderLeaf(segmentOf(group.key))}
              </TabsContent>
            ))}
          </div>
        </div>
      </Tabs>
    </div>
  );
};

export default Budget;
