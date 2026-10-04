import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { useHouseholdCore, useMealPlan, useShopping, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { wallEventConverter, wallSettingsConverter } from '@/utils/firestoreConverters';
import { DEFAULT_WALL_SETTINGS, effectiveLayout, normalizeLayout } from '@/utils/wall/wallSettings';
import type { Meal, MealPlanItem, WallEvent, WallLayout, WallSettings } from '@/types/schema';
import { syncWallCalendarsNow } from '@/components/wall/wallCalendarService';
import { WallDataContext, type WallData, type WallDataActions } from './wallData';
import { wallEventWindow } from './wallWindows';

const LAYOUT_KEY = 'LB_WALL_LAYOUT';

function readLocalLayout(): WallLayout | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? normalizeLayout(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}


/**
 * Wall data for a signed-in member opening #/wall (preview, a member's own
 * spare iPad, Test Mode), adapted from the existing household slices
 * (docs/plans/wall-display-kiosk.md §4.2). The layout is kept per device.
 */
const WallSlicesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const core = useHouseholdCore();
  const shopping = useShopping();
  const todoSlice = useTodos();
  const mealSlice = useMealPlan();
  const householdId = core.householdId;
  const [settings, setSettings] = useState<WallSettings>(DEFAULT_WALL_SETTINGS);
  const [wallEvents, setWallEvents] = useState<WallEvent[]>([]);
  const [extrasReady, setExtrasReady] = useState(false);
  const [fixtureMeals, setFixtureMeals] = useState<{ meals: Meal[]; mealPlan: MealPlanItem[] } | null>(null);
  const [localLayout, setLocalLayout] = useState<WallLayout | undefined>(readLocalLayout);

  useEffect(() => {
    if (!householdId) return undefined;
    let cancelled = false;
    // Test Mode (dev only): fixtures instead of Firestore. The condition is
    // inline so production builds drop the fixtures module entirely.
    if (
      import.meta.env.DEV &&
      import.meta.env.VITE_ENABLE_TEST_MODE === 'true' &&
      sessionStorage.getItem('LIFEBALANCE_TEST_MODE') === 'true'
    ) {
      void import('./wallFixtures').then(({ wallTestFixtures }) => {
        if (cancelled) return;
        const fx = wallTestFixtures();
        setWallEvents(fx.events);
        setSettings(fx.settings);
        setFixtureMeals({ meals: fx.meals, mealPlan: fx.mealPlan });
        setExtrasReady(true);
      });
      return () => {
        cancelled = true;
      };
    }
    const window = wallEventWindow(new Date());
    let settingsIn = false;
    let eventsIn = false;
    const settle = () => {
      if (settingsIn && eventsIn) setExtrasReady(true);
    };
    const unsubSettings = onSnapshot(
      doc(db, `households/${householdId}/wallSettings/config`).withConverter(wallSettingsConverter),
      snap => {
        setSettings(snap.data() ?? DEFAULT_WALL_SETTINGS);
        settingsIn = true;
        settle();
      },
      error => console.error('[wallSettings] listener failed:', error)
    );
    const unsubEvents = onSnapshot(
      query(
        collection(db, `households/${householdId}/wallEvents`).withConverter(wallEventConverter),
        where('date', '>=', window.start),
        where('date', '<=', window.end)
      ),
      snap => {
        setWallEvents(snap.docs.map(d => d.data()));
        eventsIn = true;
        settle();
      },
      error => console.error('[wallEvents] listener failed:', error)
    );
    return () => {
      cancelled = true;
      unsubSettings();
      unsubEvents();
    };
  }, [householdId]);

  const actions = useMemo<WallDataActions>(
    () => ({
      addShoppingItem: item => shopping.addShoppingItem(item),
      toggleShoppingItemPurchased: shopping.toggleShoppingItemPurchased,
      deleteShoppingItem: shopping.deleteShoppingItem,
      clearPurchasedShoppingItems: shopping.clearPurchasedShoppingItems,
      addToDo: todoSlice.addToDo,
      completeToDo: id => todoSlice.completeToDo(id),
      uncompleteToDo: id => todoSlice.uncompleteToDo(id),
      deleteToDo: todoSlice.deleteToDo,
      setLayout: async layout => {
        setLocalLayout(layout);
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
        } catch {
          // Per-device convenience only.
        }
      },
      syncCalendarsNow: async () => {
        if (!householdId || sessionStorage.getItem('LIFEBALANCE_TEST_MODE') === 'true') return { failed: 0 };
        return syncWallCalendarsNow(householdId);
      },
    }),
    [shopping, todoSlice, householdId]
  );

  const value = useMemo<WallData | null>(() => {
    if (!householdId) return null;
    const pinHash = core.household?.kidModePinHash;
    return {
      householdId,
      householdName: core.household?.name ?? '',
      ...(pinHash ? { kidModePinHash: pinHash } : {}),
      isDisplay: false,
      displayId: null,
      display: null,
      members: core.members,
      stores: core.household?.stores ?? [],
      wallEvents,
      todos: todoSlice.todos,
      shoppingList: shopping.shoppingList,
      groceryCatalog: shopping.groceryCatalog,
      meals: fixtureMeals?.meals ?? mealSlice.meals,
      mealPlan: fixtureMeals?.mealPlan ?? mealSlice.mealPlan,
      settings,
      layout: effectiveLayout(localLayout, settings),
      ready: !core.isLoading && extrasReady,
      actions,
    };
  }, [householdId, core.household, core.members, core.isLoading, wallEvents, todoSlice.todos, shopping.shoppingList, shopping.groceryCatalog, mealSlice.meals, mealSlice.mealPlan, fixtureMeals, settings, localLayout, extrasReady, actions]);

  if (!value) return null;
  return <WallDataContext.Provider value={value}>{children}</WallDataContext.Provider>;
};

export default WallSlicesProvider;
