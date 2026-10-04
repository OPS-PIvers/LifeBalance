import { createContext, useContext } from 'react';
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

/**
 * The one data contract every wall component reads
 * (docs/plans/wall-display-kiosk.md §4.3). Two providers implement it:
 *  - WallFirestoreProvider: a paired display (custom-token identity). It
 *    attaches ONLY the listeners the display's rules allow.
 *  - WallSlicesProvider: a signed-in member (preview, Test Mode), adapted
 *    from the existing household slices.
 * Wall components must never import the household contexts directly.
 */
export interface WallDataActions {
  addShoppingItem: (item: Omit<ShoppingItem, 'id'>) => Promise<void>;
  toggleShoppingItemPurchased: (id: string) => Promise<void>;
  deleteShoppingItem: (id: string) => Promise<void>;
  clearPurchasedShoppingItems: () => Promise<void>;
  addToDo: (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
  completeToDo: (id: string) => Promise<void>;
  uncompleteToDo: (id: string) => Promise<void>;
  deleteToDo: (id: string) => Promise<void>;
  /** Saves this wall's panel layout (per display; per device for a member preview). */
  setLayout: (layout: WallLayout) => Promise<void>;
}

export interface WallData {
  householdId: string;
  householdName: string;
  /** Kid Mode PIN hash: guards the wall's gear menu. Absent = no PIN set. */
  kidModePinHash?: string;
  isDisplay: boolean;
  displayId: string | null;
  /** This display's own doc (null in member preview). */
  display: WallDisplay | null;
  members: HouseholdMember[];
  wallEvents: WallEvent[];
  todos: ToDo[];
  shoppingList: ShoppingItem[];
  groceryCatalog: GroceryCatalogItem[];
  meals: Meal[];
  mealPlan: MealPlanItem[];
  settings: WallSettings;
  layout: WallLayout;
  /** Every listener has delivered its first snapshot. */
  ready: boolean;
  actions: WallDataActions;
}

export const WallDataContext = createContext<WallData | null>(null);

export function useWallData(): WallData {
  const value = useContext(WallDataContext);
  if (!value) throw new Error('useWallData must be used inside a wall data provider');
  return value;
}
