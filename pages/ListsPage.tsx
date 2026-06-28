import React, { useState, useEffect, useMemo } from 'react';
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

  // The sticky tab strip is only rendered when there's more than one tab; the
  // sub-tabs offset their pinned add-bars to sit just under it (0 when hidden).
  const showTabStrip = enabledTabs.length > 1;
  const stickyTopOffset = showTabStrip ? 72 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Hide the tab strip when only one tab remains — there's nothing to switch. */}
      {showTabStrip && (
        <div className="flex-none px-4 pt-4 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
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
          // Offset the to-do quick-add bar so it pins just under this page's
          // sticky tab strip (measured ~73px: px-4 pt-4 pb-2 + TabsList) — same
          // value the shopping tab uses. 0 when the strip is hidden.
          <ToDosPage stickyTopOffset={stickyTopOffset} />
        ) : activeTab === 'meals' ? (
          <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
            <MealPlanTab />
          </div>
        ) : (
          <div className="max-w-4xl mx-auto px-4 pb-20 pt-4">
            {/* Offset the shopping add bar so it pins just under this page's
                sticky tab strip (measured ~73px: px-4 pt-4 pb-2 + TabsList). */}
            <ShoppingListTab stickyTopOffset={stickyTopOffset} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ListsPage;
