import { createContext, useContext } from 'react';
import type {
  GroceryCatalogItem,
  HouseholdMember,
  Meal,
  MealPlanItem,
  ShoppingItem,
  Store,
  ToDo,
  WallCalendarFeed,
  WallDisplay,
  WallEvent,
  WallLayout,
  WallSettings,
  WallTravel,
  WallWakeFile,
} from '@/types/schema';
import type { TodoCompletionOptions, TodoSubtaskToggleResult } from '@/contexts/household/mutations/todoMutations';
import type { VoiceMissDraft } from '@/utils/wall/wallVoiceMiss';

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
  /** `options.subtaskToggle` re-unchecks the step that auto-completed it (Undo). */
  uncompleteToDo: (id: string, options?: TodoCompletionOptions) => Promise<void>;
  /** Flips one step; checking the last open one completes the to-do in the same batch. */
  toggleTodoSubtask: (todoId: string, subtaskId: string) => Promise<TodoSubtaskToggleResult>;
  deleteToDo: (id: string) => Promise<void>;
  /** Saves this wall's panel layout (per display; per device for a member preview). */
  setLayout: (layout: WallLayout) => Promise<void>;
  /** Re-syncs the household's calendar feeds and bills now (server-throttled to once per 2 min). */
  syncCalendarsNow: () => Promise<{ failed: number }>;
  /** A natural cloud voice for one phrase (base64 MP3). Rejects where there's none (Test Mode). */
  synthesizeSpeech: (text: string) => Promise<string>;
  /** A custom wake word's .onnx (`settings.wakeModel.file`). Rejects where there's none (Test Mode). */
  loadWakeFile: (file: WallWakeFile) => Promise<Uint8Array>;
  /**
   * Logs a voice command the wall got wrong (households/{id}/voiceMisses).
   * Only a paired display writes; a member preview and Test Mode skip it.
   */
  logVoiceMiss: (miss: VoiceMissDraft) => Promise<void>;
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
  /** The household's stores, in their visit order (shopping groups). */
  stores: Store[];
  wallEvents: WallEvent[];
  /** The household's calendars (which ones alert, and how people get there). */
  calendarFeeds: WallCalendarFeed[];
  /** Server-measured travel minutes for upcoming alert events. */
  travel: WallTravel[];
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
