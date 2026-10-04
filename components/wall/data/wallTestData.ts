import type { HouseholdMember } from '@/types/schema';
import { DEFAULT_WALL_SETTINGS } from '@/utils/wall/wallSettings';
import type { WallData } from './wallData';

/** Wraps an implementation in a spy: pass `vi.fn` from the test. */
type Spy = <T extends (...args: never[]) => unknown>(impl: T) => T;

/**
 * A WallData value for component tests. Every action is a resolved spy made
 * with `spy` (the test's `vi.fn`, so this file needn't import vitest);
 * override fields per test.
 */
export function makeWallData(spy: Spy, overrides: Partial<WallData> = {}): WallData {
  return {
    householdId: 'h1',
    householdName: 'Test household',
    isDisplay: true,
    displayId: 'd1',
    display: null,
    members: [
      { uid: 'p', displayName: 'Paul', role: 'admin' },
      { uid: 'l', displayName: 'Leo', role: 'member', isManaged: true },
    ] as HouseholdMember[],
    wallEvents: [],
    todos: [],
    shoppingList: [],
    groceryCatalog: [],
    meals: [],
    mealPlan: [],
    settings: DEFAULT_WALL_SETTINGS,
    layout: { modules: ['coming'] },
    ready: true,
    actions: {
      addShoppingItem: spy(async () => undefined),
      toggleShoppingItemPurchased: spy(async () => undefined),
      deleteShoppingItem: spy(async () => undefined),
      clearPurchasedShoppingItems: spy(async () => undefined),
      addToDo: spy(async () => undefined),
      completeToDo: spy(async () => undefined),
      uncompleteToDo: spy(async () => undefined),
      deleteToDo: spy(async () => undefined),
      setLayout: spy(async () => undefined),
      syncCalendarsNow: spy(async () => ({ failed: 0 })),
    },
    ...overrides,
  };
}
