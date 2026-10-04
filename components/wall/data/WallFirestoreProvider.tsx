import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { useAuth } from '@/contexts/AuthContext';
import { attachShoppingListeners } from '@/contexts/household/listeners/shoppingListeners';
import { attachTodoListeners } from '@/contexts/household/listeners/todoListeners';
import { attachMealListeners } from '@/contexts/household/listeners/mealListeners';
import { mergeById } from '@/contexts/household/selectors';
import {
  makeClearPurchasedShoppingItems,
  makeShoppingListMutations,
  makeToggleShoppingItemPurchased,
} from '@/contexts/household/mutations/shoppingMutations';
import {
  makeAddToDo,
  makeCompleteToDo,
  makeTodoCrudMutations,
  makeUncompleteToDo,
} from '@/contexts/household/mutations/todoMutations';
import {
  householdMemberConverter,
  wallDisplayConverter,
  wallEventConverter,
  wallSettingsConverter,
} from '@/utils/firestoreConverters';
import { DEFAULT_WALL_SETTINGS, effectiveLayout } from '@/utils/wall/wallSettings';
import type {
  GroceryCatalogItem,
  HouseholdMember,
  Meal,
  MealPlanItem,
  ShoppingItem,
  ToDo,
  WallDisplay,
  WallEvent,
  WallLayout,
  WallSettings,
} from '@/types/schema';
import { syncWallCalendarsNow } from '@/components/wall/wallCalendarService';
import { WallDataContext, type WallData, type WallDataActions } from './wallData';
import { wallEventWindow, wallMealPlanWindow } from './wallWindows';

const LISTENERS = ['household', 'members', 'display', 'settings', 'events', 'shopping', 'todos', 'mealPlan'] as const;
type ListenerKey = (typeof LISTENERS)[number];

interface WallFirestoreProviderProps {
  /** Called when this display is revoked or loses access. */
  onRevoked: () => void;
  children: React.ReactNode;
}

/**
 * Wall data for a paired display (docs/plans/wall-display-kiosk.md §4.3).
 * Attaches ONLY the listeners firestore.rules grant a display. It must never
 * mount FirebaseHouseholdProvider, whose finance/recap/notification
 * listeners the display can't read.
 */
const WallFirestoreProvider: React.FC<WallFirestoreProviderProps> = ({ onRevoked, children }) => {
  const { householdId, displayId, user } = useAuth();
  const [householdName, setHouseholdName] = useState('');
  const [kidModePinHash, setKidModePinHash] = useState<string | undefined>(undefined);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [display, setDisplay] = useState<WallDisplay | null>(null);
  const [settings, setSettings] = useState<WallSettings>(DEFAULT_WALL_SETTINGS);
  const [wallEvents, setWallEvents] = useState<WallEvent[]>([]);
  const [shoppingList, setShoppingList] = useState<ShoppingItem[]>([]);
  const [groceryCatalog, setGroceryCatalog] = useState<GroceryCatalogItem[]>([]);
  const [activeTodos, setActiveTodos] = useState<ToDo[]>([]);
  const [completedTodos, setCompletedTodos] = useState<ToDo[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlanItem[]>([]);
  const [delivered, setDelivered] = useState<ReadonlySet<ListenerKey>>(new Set());
  const onRevokedRef = useRef(onRevoked);

  useEffect(() => {
    onRevokedRef.current = onRevoked;
  }, [onRevoked]);

  useEffect(() => {
    if (!householdId || !displayId) return undefined;
    const mark = (key: ListenerKey) =>
      setDelivered(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
    // Only the display's OWN doc decides "revoked": rules deny reading it
    // once its status isn't 'active'. Other listeners just log, so a
    // transient error elsewhere can't unpair the wall.
    const revokedIfDenied = (error: { code?: string }) => {
      if (error.code === 'permission-denied') onRevokedRef.current();
      else console.error('[wall] display listener failed:', error);
    };
    const logError = (name: string) => (error: unknown) => console.error(`[wall] ${name} listener failed:`, error);
    const base = `households/${householdId}`;
    const today = new Date();
    const events = wallEventWindow(today);
    const unsubs: Unsubscribe[] = [];

    unsubs.push(
      onSnapshot(
        doc(db, base),
        snap => {
          const data = snap.data() ?? {};
          setHouseholdName(typeof data['name'] === 'string' ? data['name'] : '');
          setKidModePinHash(typeof data['kidModePinHash'] === 'string' ? data['kidModePinHash'] : undefined);
          mark('household');
        },
        logError('household')
      ),
      onSnapshot(
        doc(db, `${base}/displays/${displayId}`).withConverter(wallDisplayConverter),
        snap => {
          const value = snap.data() ?? null;
          if (!value || value.status !== 'active') {
            // Only the server can say we're revoked: an offline cold start
            // reads a possibly-empty cache, which must not unpair the wall.
            if (!snap.metadata.fromCache) onRevokedRef.current();
            return;
          }
          setDisplay(value);
          mark('display');
        },
        revokedIfDenied
      ),
      onSnapshot(
        collection(db, `${base}/members`).withConverter(householdMemberConverter),
        snap => {
          setMembers(snap.docs.map(d => d.data()));
          mark('members');
        },
        logError('members')
      ),
      onSnapshot(
        doc(db, `${base}/wallSettings/config`).withConverter(wallSettingsConverter),
        snap => {
          setSettings(snap.data() ?? DEFAULT_WALL_SETTINGS);
          mark('settings');
        },
        logError('wallSettings')
      ),
      onSnapshot(
        query(
          collection(db, `${base}/wallEvents`).withConverter(wallEventConverter),
          where('date', '>=', events.start),
          where('date', '<=', events.end)
        ),
        snap => {
          setWallEvents(snap.docs.map(d => d.data()));
          mark('events');
        },
        logError('wallEvents')
      ),
      ...attachShoppingListeners({
        db,
        householdId,
        setShoppingList: items => {
          setShoppingList(items);
          mark('shopping');
        },
        setGroceryCatalogWindow: setGroceryCatalog,
      }),
      ...attachTodoListeners({
        db,
        householdId,
        completedTodoWindowStartRef: { current: null },
        setActiveTodos: todos => {
          setActiveTodos(todos);
          mark('todos');
        },
        setCompletedTodos,
      }),
      ...attachMealListeners({
        db,
        householdId,
        mealPlanRange: wallMealPlanWindow(today),
        setMealsWindow: setMeals,
        setMealPlanWindow: items => {
          setMealPlan(items);
          mark('mealPlan');
        },
      })
    );
    return () => unsubs.forEach(u => u());
  }, [householdId, displayId]);

  // Same visibility split as FirebaseHouseholdProvider: held-for-review and
  // saved-for-later items never show on the wall. Actions keep the raw lists.
  const todos = useMemo(
    () => mergeById(activeTodos, completedTodos).filter(t => t.needsReview !== true && t.savedForLater !== true),
    [activeTodos, completedTodos]
  );
  const visibleShopping = useMemo(
    () => shoppingList.filter(item => item.needsReview !== true && item.savedForLater !== true),
    [shoppingList]
  );

  // The factories read members (kid points credit) through a ref-shaped box;
  // the callbacks rebuild it from current state when members change.
  const completeToDo = useCallback(async (id: string) => {
    await makeCompleteToDo({ db, householdId, membersRef: { current: members }, user }).completeToDo(id);
  }, [householdId, user, members]);
  const uncompleteToDo = useCallback(async (id: string) => {
    await makeUncompleteToDo({ db, householdId, membersRef: { current: members }, user }).uncompleteToDo(id);
  }, [householdId, user, members]);

  const actions = useMemo<WallDataActions>(() => {
    const shopping = makeShoppingListMutations({ db, householdId });
    const { toggleShoppingItemPurchased } = makeToggleShoppingItemPurchased({ db, householdId, shoppingList, groceryCatalog });
    const { clearPurchasedShoppingItems } = makeClearPurchasedShoppingItems({ db, householdId, shoppingList });
    const { addToDo } = makeAddToDo({ db, householdId, user });
    const { deleteToDo } = makeTodoCrudMutations({ db, householdId });
    return {
      addShoppingItem: item => shopping.addShoppingItem(item),
      toggleShoppingItemPurchased,
      deleteShoppingItem: shopping.deleteShoppingItem,
      clearPurchasedShoppingItems,
      addToDo,
      completeToDo,
      uncompleteToDo,
      deleteToDo,
      setLayout: async (layout: WallLayout) => {
        if (!householdId || !displayId) return;
        await updateDoc(doc(db, `households/${householdId}/displays/${displayId}`), { layout });
      },
      syncCalendarsNow: () => syncWallCalendarsNow(householdId ?? ''),
    };
  }, [householdId, displayId, user, shoppingList, groceryCatalog, completeToDo, uncompleteToDo]);

  const value = useMemo<WallData | null>(() => {
    if (!householdId) return null;
    return {
      householdId,
      householdName,
      ...(kidModePinHash ? { kidModePinHash } : {}),
      isDisplay: true,
      displayId,
      display,
      members,
      wallEvents,
      todos,
      shoppingList: visibleShopping,
      groceryCatalog,
      meals,
      mealPlan,
      settings,
      layout: effectiveLayout(display?.layout, settings),
      ready: LISTENERS.every(key => delivered.has(key)),
      actions,
    };
  }, [householdId, householdName, kidModePinHash, displayId, display, members, wallEvents, todos, visibleShopping, groceryCatalog, meals, mealPlan, settings, delivered, actions]);

  if (!value) return null;
  return <WallDataContext.Provider value={value}>{children}</WallDataContext.Provider>;
};

export default WallFirestoreProvider;
