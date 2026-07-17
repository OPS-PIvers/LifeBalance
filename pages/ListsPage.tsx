import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs';
import ToDosPage from './ToDosPage';
import MealPlanTab from '@/components/meals/MealPlanTab';
import ShoppingListTab from '@/components/meals/ShoppingListTab';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { PlanTab } from '@/utils/moduleVisibility';

const VALID_TABS = ['todos', 'meals', 'shopping'] as const;

const TAB_LABELS: Record<PlanTab, string> = {
  todos: 'To-Dos',
  meals: 'Meals',
  shopping: 'Shopping',
};

const ListsPage: React.FC = () => {
  const { isPlanTabVisible } = useModuleVisibility();

  // The tabs this household has enabled, in canonical order. The ModuleRoute
  // guard already redirects away when none are enabled (isPlanVisible false), so
  // in practice this is never empty when the page renders.
  const enabledTabs = useMemo<PlanTab[]>(
    () => VALID_TABS.filter((tab) => isPlanTabVisible(tab)),
    [isPlanTabVisible]
  );

  // Smart Memory: `selectedTab` is the user's PREFERENCE, seeded from
  // localStorage. The tab actually shown is derived below (`activeTab`) so a
  // disabled/absent preference falls back to the first enabled tab WITHOUT a
  // setState-in-effect (which would cause cascading renders). When the user
  // re-enables a tab, their stored preference is honored again automatically.
  const [selectedTab, setSelectedTab] = useState<PlanTab>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('lists-active-tab');
        if (stored && VALID_TABS.includes(stored as PlanTab)) {
          return stored as PlanTab;
        }
      }
    } catch (_error) {
      // Ignore localStorage errors
    }
    return 'todos';
  });

  // Effective tab: the preference if it's enabled, else the first enabled tab.
  // Defaults to 'todos' only as a guard for the never-rendered no-tabs case.
  const activeTab: PlanTab = enabledTabs.includes(selectedTab)
    ? selectedTab
    : enabledTabs[0] ?? 'todos';

  // Persist the user's PREFERENCE (not the effective tab) so re-enabling a
  // previously-disabled tab restores it even across a full page reload — the
  // fallback to the first enabled tab is always re-derived from `selectedTab`.
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('lists-active-tab', selectedTab);
      }
    } catch (_error) {
      // Ignore persistence errors
    }
  }, [selectedTab]);

  // The sticky tab strip is only rendered when there's more than one tab.
  const showTabStrip = enabledTabs.length > 1;

  // Publish the strip's measured height as --lists-sticky-top so nested sticky
  // elements (e.g. the shopping list's add row) can pin themselves flush BELOW
  // the strip instead of sliding underneath it. Written straight to the DOM
  // (no state) — a re-render for a pixel offset would be wasted work.
  const containerRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const strip = tabStripRef.current;
    const update = () => {
      container.style.setProperty('--lists-sticky-top', `${strip ? strip.offsetHeight : 0}px`);
    };
    update();
    if (!strip || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [showTabStrip]);

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Page masthead — named to match the bottom nav's "Plan" item, so the
          surface has ONE identity (the nav label wins; "/lists" and the
          storage key stay as-is — they're routing/persistence contracts, not
          user-facing names). The header scrolls away; only the strip sticks. */}
      <PageHeader title="Plan" className="pb-2" />
      {/* Hide the tab strip when only one tab remains — there's nothing to switch. */}
      {showTabStrip && (
        <div ref={tabStripRef} className="flex-none px-4 pt-1 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
          <Tabs value={activeTab} onValueChange={(value) => setSelectedTab(value as PlanTab)}>
            <TabsList>
              {enabledTabs.map((tab) => (
                <TabsTrigger key={tab} value={tab} className="flex-1">
                  {TAB_LABELS[tab]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      <div className="flex-1">
        {activeTab === 'todos' ? (
          <ToDosPage />
        ) : activeTab === 'meals' ? (
          // Shared content column width/top padding across all three tabs
          // (matches ToDosPage's own `max-w-2xl px-4` wrapper) so switching
          // tabs doesn't visibly reflow the container.
          <div className="max-w-2xl mx-auto px-4 pb-nav-safe pt-4">
            <MealPlanTab />
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 pb-nav-safe pt-4">
            <ShoppingListTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default ListsPage;
