import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
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

  // The tabs this household AND this member have enabled (2F.1), in canonical
  // order. The ModuleRoute guard already redirects away when none are enabled
  // (isPlanVisible false), so in practice this is never empty when the page
  // renders. `showTabStrip` below is this page's COLLAPSE RULE: one tab left
  // means nothing to switch between, so tapping Lists simply IS that tab.
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
  // The 'todos' fallback only satisfies the type — the no-tabs case returns
  // early below rather than rendering a tab nobody enabled.
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

  // DEFENCE IN DEPTH (matching pages/Budget.tsx and pages/Habits.tsx): no
  // reachable tab means `ModuleRoute` is already redirecting `/lists` away, so
  // this is only the frame between that decision and the redirect. Falling
  // through would render the To-Dos tab nobody enabled.
  if (enabledTabs.length === 0) return null;

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* No visible masthead: the bottom nav's active "Lists" item + the tab
          strip already say where you are, and the title row cost a full band
          of vertical space before any content. The h1 stays for the document
          outline / screen readers only. */}
      <h1 className="sr-only">Lists</h1>
      {/* Hide the tab strip when only one tab remains — there's nothing to switch. */}
      {showTabStrip && (
        <div ref={tabStripRef} className="flex-none px-4 pt-3 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
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
          // No pt-4: ShoppingListTab's sticky PageHeader owns pt-4; stacking a second made at-rest taller than pinned.
          <div className="max-w-2xl mx-auto px-4 pb-nav-safe">
            <ShoppingListTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default ListsPage;
