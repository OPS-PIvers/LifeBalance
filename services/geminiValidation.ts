/**
 * Hand-written runtime validators for Gemini JSON responses.
 *
 * The Gemini SDK is asked for a `responseSchema`, but the model can still
 * hallucinate missing/wrong-typed fields or return a non-conforming shape
 * (and the schema constraint is best-effort, not a hard guarantee). Every
 * caller therefore validates the parsed JSON BEFORE the `as T` cast so a
 * malformed response is rejected cleanly instead of corrupting downstream
 * state.
 *
 * Design notes:
 * - Zero dependencies — these are plain type guards, no zod/io-ts, so the AI
 *   boot bundle stays lean (CLAUDE.md: keep `@google/genai` and friends out of
 *   the boot path).
 * - Validators are permissive about OPTIONAL fields (they may be absent or, if
 *   present, must have the right type) and strict about REQUIRED fields. This
 *   mirrors each response interface in `geminiService.types.ts` / `schema.ts`.
 * - On failure they throw {@link GeminiValidationError} so callers can tell a
 *   "model returned garbage" failure apart from an API/network/quota failure.
 */

import type { Meal, InsightAction } from '@/types/schema';
import type { WeeklyPlan } from '@/types/weeklyPlan';
import type {
  ReceiptData,
  ReceiptLineItemsData,
  ParsedShoppingList,
  ParsedTodoList,
  ParsedExpense,
  ParsedTaskList,
  ParsedMealPlan,
  OptimizableItem,
  HabitPatternInsight,
  HabitReorganizationPlan,
  HabitPointAdjustmentSuggestion,
  MagicActionResponse,
} from './geminiService.types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when a parsed Gemini response fails runtime validation. Distinct from
 * generic API/network errors so callers (and the shared error wrapper) can
 * surface an "AI returned an unexpected response" message rather than masking a
 * validation bug as an outage.
 */
export class GeminiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeminiValidationError';
  }
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === 'string';
const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

// Optional-field guards accept `null` as well as `undefined`: AI models routinely
// return `null` for fields they can't populate rather than omitting them, and
// consumers treat both as "absent" (falsy / optional chaining).
const isOptString = (v: unknown): v is string | undefined | null =>
  v === undefined || v === null || isString(v);
const isOptNumber = (v: unknown): v is number | undefined | null =>
  v === undefined || v === null || isFiniteNumber(v);
const isOptBoolean = (v: unknown): v is boolean | undefined | null =>
  v === undefined || v === null || isBoolean(v);
const isOptStringArray = (v: unknown): v is string[] | undefined | null =>
  v === undefined || v === null || (Array.isArray(v) && v.every(isString));

/** Throws a {@link GeminiValidationError} with a contextual message. */
const fail = (context: string, detail: string): never => {
  throw new GeminiValidationError(`Invalid AI response (${context}): ${detail}`);
};

/** Validates that `raw` is an array, returning it typed as unknown[]. */
const expectArray = (raw: unknown, context: string): unknown[] => {
  if (!Array.isArray(raw)) {
    return fail(context, `expected an array, got ${typeof raw}`);
  }
  return raw;
};

/** Validates that `raw` is a plain object. */
const expectRecord = (raw: unknown, context: string): Record<string, unknown> => {
  if (!isRecord(raw)) {
    return fail(context, `expected an object, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }
  return raw;
};

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

export function validateReceiptData(raw: unknown): ReceiptData {
  const o = expectRecord(raw, 'receipt');
  if (!isString(o['merchant'])) fail('receipt', 'merchant must be a string');
  if (!isFiniteNumber(o['amount'])) fail('receipt', 'amount must be a number');
  if (!isString(o['category'])) fail('receipt', 'category must be a string');
  if (!isOptString(o['date'])) fail('receipt', 'date must be a string');
  if (!isOptStringArray(o['suggestedHabits'])) fail('receipt', 'suggestedHabits must be string[]');
  if (!isOptString(o['store'])) fail('receipt', 'store must be a string');
  return o as unknown as ReceiptData;
}

// ---------------------------------------------------------------------------
// Bank statement transactions
// ---------------------------------------------------------------------------

export interface BankTransactionLike {
  merchant: string;
  amount: number;
  category: string;
  date: string;
  suggestedHabits?: string[];
}

export function validateBankTransactions(raw: unknown): BankTransactionLike[] {
  const arr = expectArray(raw, 'bankStatement');
  return arr.map((entry, i): BankTransactionLike => {
    const o = expectRecord(entry, `bankStatement[${i}]`);
    if (!isString(o['merchant'])) fail(`bankStatement[${i}]`, 'merchant must be a string');
    if (!isFiniteNumber(o['amount'])) fail(`bankStatement[${i}]`, 'amount must be a number');
    if (!isString(o['category'])) fail(`bankStatement[${i}]`, 'category must be a string');
    if (!isString(o['date'])) fail(`bankStatement[${i}]`, 'date must be a string');
    if (!isOptStringArray(o['suggestedHabits'])) fail(`bankStatement[${i}]`, 'suggestedHabits must be string[]');
    return o as unknown as BankTransactionLike;
  });
}

// ---------------------------------------------------------------------------
// Meal suggestion
// ---------------------------------------------------------------------------

export interface MealSuggestionLike {
  name: string;
  description: string;
  ingredients: { name: string; quantity: string }[];
  instructions: string[];
  recipeUrl: string;
  tags: string[];
  reasoning: string;
}

export function validateMealSuggestion(raw: unknown): MealSuggestionLike {
  const o = expectRecord(raw, 'mealSuggestion');
  if (!isString(o['name'])) fail('mealSuggestion', 'name must be a string');
  if (!isString(o['description'])) fail('mealSuggestion', 'description must be a string');
  // recipeUrl is no longer requested from the model (it can't know a real URL);
  // suggestMeal sets it deterministically after validation. Accept it if present.
  if (!isOptString(o['recipeUrl'])) fail('mealSuggestion', 'recipeUrl must be a string');
  if (!isString(o['reasoning'])) fail('mealSuggestion', 'reasoning must be a string');
  if (!Array.isArray(o['instructions']) || !o['instructions'].every(isString)) {
    fail('mealSuggestion', 'instructions must be string[]');
  }
  if (!Array.isArray(o['tags']) || !o['tags'].every(isString)) {
    fail('mealSuggestion', 'tags must be string[]');
  }
  const ingredients = expectArray(o['ingredients'], 'mealSuggestion.ingredients');
  ingredients.forEach((ing, i) => {
    const ingObj = expectRecord(ing, `mealSuggestion.ingredients[${i}]`);
    if (!isString(ingObj['name'])) fail(`mealSuggestion.ingredients[${i}]`, 'name must be a string');
    if (!isString(ingObj['quantity'])) fail(`mealSuggestion.ingredients[${i}]`, 'quantity must be a string');
  });
  return o as unknown as MealSuggestionLike;
}

// ---------------------------------------------------------------------------
// Grocery items (receipt parse)
// ---------------------------------------------------------------------------

export interface GroceryItemLike {
  name: string;
  quantity?: string;
  category: string;
  store?: string;
}

export function validateGroceryItems(raw: unknown): GroceryItemLike[] {
  const arr = expectArray(raw, 'groceryReceipt');
  return arr.map((entry, i): GroceryItemLike => {
    const o = expectRecord(entry, `groceryReceipt[${i}]`);
    if (!isString(o['name'])) fail(`groceryReceipt[${i}]`, 'name must be a string');
    if (!isString(o['category'])) fail(`groceryReceipt[${i}]`, 'category must be a string');
    if (!isOptString(o['quantity'])) fail(`groceryReceipt[${i}]`, 'quantity must be a string');
    if (!isOptString(o['store'])) fail(`groceryReceipt[${i}]`, 'store must be a string');
    return o as unknown as GroceryItemLike;
  });
}

// ---------------------------------------------------------------------------
// Subtask breakdown (F-TODO-08)
// ---------------------------------------------------------------------------

/**
 * Validates the "break a task into steps" response: an object `{ subtasks: string[] }`.
 * Returns the trimmed, non-empty subtask strings.
 */
export function validateSubtaskSuggestions(raw: unknown): string[] {
  const o = expectRecord(raw, 'subtaskBreakdown');
  const arr = expectArray(o['subtasks'], 'subtaskBreakdown.subtasks');
  return arr
    .map((entry, i): string => {
      if (!isString(entry)) fail(`subtaskBreakdown.subtasks[${i}]`, 'must be a string');
      return (entry as string).trim();
    })
    .filter(s => s.length > 0);
}

// ---------------------------------------------------------------------------
// Itemized receipt line items (F-DASH-04)
// ---------------------------------------------------------------------------

export function validateReceiptLineItems(raw: unknown): ReceiptLineItemsData {
  const o = expectRecord(raw, 'receiptLineItems');
  if (!isString(o['merchant'])) fail('receiptLineItems', 'merchant must be a string');
  if (!isOptString(o['date'])) fail('receiptLineItems', 'date must be a string');
  if (!isOptString(o['store'])) fail('receiptLineItems', 'store must be a string');
  const items = expectArray(o['items'], 'receiptLineItems.items');
  items.forEach((entry, i) => {
    const item = expectRecord(entry, `receiptLineItems.items[${i}]`);
    if (!isString(item['description'])) fail(`receiptLineItems.items[${i}]`, 'description must be a string');
    if (!isFiniteNumber(item['amount'])) fail(`receiptLineItems.items[${i}]`, 'amount must be a number');
    if (!isString(item['category'])) fail(`receiptLineItems.items[${i}]`, 'category must be a string');
  });
  return o as unknown as ReceiptLineItemsData;
}

// ---------------------------------------------------------------------------
// Grocery list optimization
// ---------------------------------------------------------------------------

export function validateOptimizableItems(raw: unknown): OptimizableItem[] {
  const arr = expectArray(raw, 'optimizeList');
  return arr.map((entry, i): OptimizableItem => {
    const o = expectRecord(entry, `optimizeList[${i}]`);
    if (!isString(o['id'])) fail(`optimizeList[${i}]`, 'id must be a string');
    if (!isString(o['name'])) fail(`optimizeList[${i}]`, 'name must be a string');
    if (!isOptString(o['category'])) fail(`optimizeList[${i}]`, 'category must be a string');
    if (!isOptString(o['quantity'])) fail(`optimizeList[${i}]`, 'quantity must be a string');
    if (!isOptString(o['store'])) fail(`optimizeList[${i}]`, 'store must be a string');
    return o as unknown as OptimizableItem;
  });
}

// ---------------------------------------------------------------------------
// Insight (text + optional actions)
// ---------------------------------------------------------------------------

const INSIGHT_ACTION_TYPES = ['update_bucket', 'create_habit', 'create_todo', 'create_challenge'];

export interface InsightResult {
  text: string;
  actions?: InsightAction[];
}

/**
 * Per-action-type required payload fields. The response schema shares ONE flat
 * payload object across all four action types, so it cannot express that, say,
 * `update_bucket` needs bucketName+newLimit. We enforce it here instead.
 */
function insightActionIsWellFormed(a: Record<string, unknown>): boolean {
  if (!isString(a['type']) || !INSIGHT_ACTION_TYPES.includes(a['type'])) return false;
  if (!isString(a['label'])) return false;
  if (!isRecord(a['payload'])) return false;
  const p = a['payload'];
  switch (a['type']) {
    case 'update_bucket':
      return isString(p['bucketName']) && isFiniteNumber(p['newLimit']);
    case 'create_todo':
      return isString(p['text']);
    case 'create_habit':
    case 'create_challenge':
      return isString(p['title']);
    default:
      return false;
  }
}

export function validateInsight(raw: unknown): InsightResult {
  const o = expectRecord(raw, 'insight');
  if (!isString(o['text'])) fail('insight', 'text must be a string');
  // The insight TEXT is the primary value; actions are secondary. Rather than
  // failing the whole response on one malformed action, drop the bad ones and
  // keep the text + any well-formed actions.
  let cleanedActions: unknown[] | undefined;
  if (o['actions'] !== undefined) {
    const arr = expectArray(o['actions'], 'insight.actions');
    cleanedActions = arr.filter((entry) => isRecord(entry) && insightActionIsWellFormed(entry));
  }
  return { text: o['text'] as string, actions: cleanedActions as InsightResult['actions'] };
}

// ---------------------------------------------------------------------------
// Magic action (discriminated union on `type`)
// ---------------------------------------------------------------------------

const MAGIC_ACTION_TYPES = ['transaction', 'todo', 'shopping', 'unknown'];

export function validateMagicAction(raw: unknown): MagicActionResponse {
  const o = expectRecord(raw, 'magicAction');
  if (!isString(o['type']) || !MAGIC_ACTION_TYPES.includes(o['type'])) {
    fail('magicAction', `type must be one of ${MAGIC_ACTION_TYPES.join(', ')}`);
  }
  if (!isFiniteNumber(o['confidence'])) fail('magicAction', 'confidence must be a number');
  const data = expectRecord(o['data'], 'magicAction.data');
  // All data fields are optional; validate types when present.
  if (!isOptString(data['merchant'])) fail('magicAction.data', 'merchant must be a string');
  if (!isOptNumber(data['amount'])) fail('magicAction.data', 'amount must be a number');
  if (!isOptString(data['category'])) fail('magicAction.data', 'category must be a string');
  if (!isOptString(data['date'])) fail('magicAction.data', 'date must be a string');
  if (!isOptString(data['text'])) fail('magicAction.data', 'text must be a string');
  if (!isOptString(data['completeByDate'])) fail('magicAction.data', 'completeByDate must be a string');
  if (!isOptString(data['item'])) fail('magicAction.data', 'item must be a string');
  if (!isOptString(data['quantity'])) fail('magicAction.data', 'quantity must be a string');
  if (!isOptString(data['store'])) fail('magicAction.data', 'store must be a string');
  return o as unknown as MagicActionResponse;
}

// ---------------------------------------------------------------------------
// Habit point adjustment suggestions
// ---------------------------------------------------------------------------

export function validateHabitPointSuggestions(raw: unknown): HabitPointAdjustmentSuggestion[] {
  const arr = expectArray(raw, 'habitPoints');
  return arr.map((entry, i): HabitPointAdjustmentSuggestion => {
    const o = expectRecord(entry, `habitPoints[${i}]`);
    if (!isString(o['habitId'])) fail(`habitPoints[${i}]`, 'habitId must be a string');
    if (!isString(o['habitTitle'])) fail(`habitPoints[${i}]`, 'habitTitle must be a string');
    if (!isFiniteNumber(o['currentPoints'])) fail(`habitPoints[${i}]`, 'currentPoints must be a number');
    if (!isFiniteNumber(o['suggestedPoints'])) fail(`habitPoints[${i}]`, 'suggestedPoints must be a number');
    if (!isString(o['reasoning'])) fail(`habitPoints[${i}]`, 'reasoning must be a string');
    return o as unknown as HabitPointAdjustmentSuggestion;
  });
}

// ---------------------------------------------------------------------------
// Habit pattern insights
// ---------------------------------------------------------------------------

const HABIT_PATTERN_TYPES = ['praise', 'critique', 'suggestion'];

export function validateHabitPatterns(raw: unknown): HabitPatternInsight[] {
  const arr = expectArray(raw, 'habitPatterns');
  return arr.map((entry, i): HabitPatternInsight => {
    const o = expectRecord(entry, `habitPatterns[${i}]`);
    if (!isString(o['title'])) fail(`habitPatterns[${i}]`, 'title must be a string');
    if (!isString(o['description'])) fail(`habitPatterns[${i}]`, 'description must be a string');
    if (!isString(o['type']) || !HABIT_PATTERN_TYPES.includes(o['type'])) {
      fail(`habitPatterns[${i}]`, `type must be one of ${HABIT_PATTERN_TYPES.join(', ')}`);
    }
    // relatedHabitId is optional and may be null (schema marks it nullable).
    const related = o['relatedHabitId'];
    if (related !== undefined && related !== null && !isString(related)) {
      fail(`habitPatterns[${i}]`, 'relatedHabitId must be a string');
    }
    return o as unknown as HabitPatternInsight;
  });
}

// ---------------------------------------------------------------------------
// Habit reorganization plan
// ---------------------------------------------------------------------------

export function validateHabitReorganization(raw: unknown): HabitReorganizationPlan {
  const o = expectRecord(raw, 'reorganizeHabits');
  if (!isString(o['reasoning'])) fail('reorganizeHabits', 'reasoning must be a string');
  const habits = expectArray(o['habits'], 'reorganizeHabits.habits');
  habits.forEach((entry, i) => {
    const h = expectRecord(entry, `reorganizeHabits.habits[${i}]`);
    if (!isString(h['id'])) fail(`reorganizeHabits.habits[${i}]`, 'id must be a string');
    if (!isString(h['category'])) fail(`reorganizeHabits.habits[${i}]`, 'category must be a string');
    if (!isFiniteNumber(h['order'])) fail(`reorganizeHabits.habits[${i}]`, 'order must be a number');
  });
  return o as unknown as HabitReorganizationPlan;
}

// ---------------------------------------------------------------------------
// Natural-language command results (per detected type)
// ---------------------------------------------------------------------------

export function validateParsedShoppingList(raw: unknown): ParsedShoppingList {
  const o = expectRecord(raw, 'shoppingList');
  const items = expectArray(o['items'], 'shoppingList.items');
  items.forEach((entry, i) => {
    const it = expectRecord(entry, `shoppingList.items[${i}]`);
    if (!isString(it['item'])) fail(`shoppingList.items[${i}]`, 'item must be a string');
    if (!isFiniteNumber(it['quantity'])) fail(`shoppingList.items[${i}]`, 'quantity must be a number');
    if (!isString(it['category'])) fail(`shoppingList.items[${i}]`, 'category must be a string');
  });
  return o as unknown as ParsedShoppingList;
}

export function validateParsedTodoList(raw: unknown): ParsedTodoList {
  const o = expectRecord(raw, 'todoList');
  const tasks = expectArray(o['tasks'], 'todoList.tasks');
  tasks.forEach((entry, i) => {
    const t = expectRecord(entry, `todoList.tasks[${i}]`);
    if (!isString(t['task'])) fail(`todoList.tasks[${i}]`, 'task must be a string');
    if (!isString(t['priority']) || !['low', 'medium', 'high'].includes(t['priority'])) {
      fail(`todoList.tasks[${i}]`, 'priority must be low|medium|high');
    }
  });
  return o as unknown as ParsedTodoList;
}

// ---------------------------------------------------------------------------
// Photo-to-tasklist (F-TODO-06)
// ---------------------------------------------------------------------------

const MEAL_PLAN_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];

export function validateParsedTaskList(raw: unknown): ParsedTaskList {
  const o = expectRecord(raw, 'taskList');
  const tasks = expectArray(o['tasks'], 'taskList.tasks');
  tasks.forEach((entry, i) => {
    const t = expectRecord(entry, `taskList.tasks[${i}]`);
    if (!isString(t['text'])) fail(`taskList.tasks[${i}]`, 'text must be a string');
  });
  return o as unknown as ParsedTaskList;
}

export function validateParsedMealPlan(raw: unknown): ParsedMealPlan {
  const o = expectRecord(raw, 'mealPlan');
  const meals = expectArray(o['meals'], 'mealPlan.meals');
  meals.forEach((entry, i) => {
    const m = expectRecord(entry, `mealPlan.meals[${i}]`);
    if (!isString(m['mealName'])) fail(`mealPlan.meals[${i}]`, 'mealName must be a string');
    if (!isString(m['type']) || !MEAL_PLAN_SLOTS.includes(m['type'])) {
      fail(`mealPlan.meals[${i}]`, `type must be one of ${MEAL_PLAN_SLOTS.join(', ')}`);
    }
    if (!isOptString(m['day'])) fail(`mealPlan.meals[${i}]`, 'day must be a string');
  });
  return o as unknown as ParsedMealPlan;
}

export function validateParsedExpense(raw: unknown): ParsedExpense {
  const o = expectRecord(raw, 'expense');
  // Every field is optional; validate types when present.
  if (!isOptNumber(o['amount'])) fail('expense', 'amount must be a number');
  if (!isOptString(o['merchant'])) fail('expense', 'merchant must be a string');
  if (!isOptString(o['category'])) fail('expense', 'category must be a string');
  if (!isOptString(o['notes'])) fail('expense', 'notes must be a string');
  if (!isOptString(o['error'])) fail('expense', 'error must be a string');
  return o as unknown as ParsedExpense;
}

/**
 * Validates the "unknown type" one-shot natural-language response, which carries
 * a `detectedType` discriminant plus the union of all per-type data fields.
 */
export interface NaturalLanguageUnknownLike {
  detectedType: 'shopping' | 'todo' | 'expense' | 'unclear';
  confidence: number;
  items?: ParsedShoppingList['items'];
  tasks?: ParsedTodoList['tasks'];
  amount?: number;
  merchant?: string;
  category?: string;
  notes?: string;
  error?: string;
}

export function validateNaturalLanguageUnknown(raw: unknown): NaturalLanguageUnknownLike {
  const o = expectRecord(raw, 'naturalLanguage');
  const detected = o['detectedType'];
  if (!isString(detected) || !['shopping', 'todo', 'expense', 'unclear'].includes(detected)) {
    fail('naturalLanguage', 'detectedType must be shopping|todo|expense|unclear');
  }
  if (!isFiniteNumber(o['confidence'])) fail('naturalLanguage', 'confidence must be a number');

  // Validate whichever payload matches the discriminant; tolerate the others
  // being absent (the loose one-shot schema only fills the relevant branch).
  if (detected === 'shopping' && o['items'] !== undefined) {
    validateParsedShoppingList({ items: o['items'] });
  }
  if (detected === 'todo' && o['tasks'] !== undefined) {
    validateParsedTodoList({ tasks: o['tasks'] });
  }
  if (detected === 'expense') {
    if (!isOptNumber(o['amount'])) fail('naturalLanguage', 'amount must be a number');
    if (!isOptString(o['merchant'])) fail('naturalLanguage', 'merchant must be a string');
    if (!isOptString(o['category'])) fail('naturalLanguage', 'category must be a string');
    if (!isOptString(o['notes'])) fail('naturalLanguage', 'notes must be a string');
  }
  return o as unknown as NaturalLanguageUnknownLike;
}

// ---------------------------------------------------------------------------
// Recipe (Partial<Meal>)
// ---------------------------------------------------------------------------

export function validateRecipe(raw: unknown): Partial<Meal> {
  const o = expectRecord(raw, 'recipe');
  if (!isOptString(o['name'])) fail('recipe', 'name must be a string');
  if (!isOptString(o['description'])) fail('recipe', 'description must be a string');
  if (!isOptString(o['recipeUrl'])) fail('recipe', 'recipeUrl must be a string');
  if (o['instructions'] !== undefined &&
      (!Array.isArray(o['instructions']) || !o['instructions'].every(isString))) {
    fail('recipe', 'instructions must be string[]');
  }
  if (o['tags'] !== undefined &&
      (!Array.isArray(o['tags']) || !o['tags'].every(isString))) {
    fail('recipe', 'tags must be string[]');
  }
  if (o['ingredients'] !== undefined) {
    const ingredients = expectArray(o['ingredients'], 'recipe.ingredients');
    ingredients.forEach((ing, i) => {
      const ingObj = expectRecord(ing, `recipe.ingredients[${i}]`);
      if (!isString(ingObj['name'])) fail(`recipe.ingredients[${i}]`, 'name must be a string');
      // quantity is optional in MealIngredient on a parsed recipe.
      if (!isOptString(ingObj['quantity'])) fail(`recipe.ingredients[${i}]`, 'quantity must be a string');
    });
  }
  return o as unknown as Partial<Meal>;
}

// ---------------------------------------------------------------------------
// Weekly plan (the raw shape Gemini returns; stores as array)
// ---------------------------------------------------------------------------

export interface GeneratedWeeklyPlanLike {
  weekLabel?: string;
  subtitle?: string;
  stores?: { key: string; name: string; why?: string }[];
  meals: WeeklyPlan['meals'];
  items: WeeklyPlan['items'];
}

function validateWeeklyPlanStep(raw: unknown, context: string): void {
  const o = expectRecord(raw, context);
  if (!isString(o['t'])) fail(context, 't must be a string');
  if (!isFiniteNumber(o['min'])) fail(context, 'min must be a number');
  if (o['det'] !== undefined && !(Array.isArray(o['det']) && o['det'].every(isString))) {
    fail(context, 'det must be string[]');
  }
  if (!isOptBoolean(o['kid'])) fail(context, 'kid must be a boolean');
  if (!isOptBoolean(o['off'])) fail(context, 'off must be a boolean');
  if (!isOptNumber(o['timer'])) fail(context, 'timer must be a number');
}

export function validateGeneratedWeeklyPlan(raw: unknown): GeneratedWeeklyPlanLike {
  const o = expectRecord(raw, 'weeklyPlan');
  if (!isOptString(o['weekLabel'])) fail('weeklyPlan', 'weekLabel must be a string');
  if (!isOptString(o['subtitle'])) fail('weeklyPlan', 'subtitle must be a string');

  if (o['stores'] !== undefined) {
    const stores = expectArray(o['stores'], 'weeklyPlan.stores');
    stores.forEach((entry, i) => {
      const s = expectRecord(entry, `weeklyPlan.stores[${i}]`);
      if (!isString(s['key'])) fail(`weeklyPlan.stores[${i}]`, 'key must be a string');
      if (!isString(s['name'])) fail(`weeklyPlan.stores[${i}]`, 'name must be a string');
      if (!isOptString(s['why'])) fail(`weeklyPlan.stores[${i}]`, 'why must be a string');
    });
  }

  const meals = expectArray(o['meals'], 'weeklyPlan.meals');
  meals.forEach((entry, i) => {
    const m = expectRecord(entry, `weeklyPlan.meals[${i}]`);
    if (!isString(m['name'])) fail(`weeklyPlan.meals[${i}]`, 'name must be a string');
    if (!Array.isArray(m['ingredients']) || !m['ingredients'].every(isString)) {
      fail(`weeklyPlan.meals[${i}]`, 'ingredients must be string[]');
    }
    if (!isOptString(m['cuisine'])) fail(`weeklyPlan.meals[${i}]`, 'cuisine must be a string');
    if (!isOptString(m['effort'])) fail(`weeklyPlan.meals[${i}]`, 'effort must be a string');
    if (!isOptNumber(m['activeMin'])) fail(`weeklyPlan.meals[${i}]`, 'activeMin must be a number');
    if (m['prep'] !== undefined) {
      expectArray(m['prep'], `weeklyPlan.meals[${i}].prep`).forEach((s, j) =>
        validateWeeklyPlanStep(s, `weeklyPlan.meals[${i}].prep[${j}]`));
    }
    if (m['cook'] !== undefined) {
      expectArray(m['cook'], `weeklyPlan.meals[${i}].cook`).forEach((s, j) =>
        validateWeeklyPlanStep(s, `weeklyPlan.meals[${i}].cook[${j}]`));
    }
  });

  const items = expectArray(o['items'], 'weeklyPlan.items');
  items.forEach((entry, i) => {
    const it = expectRecord(entry, `weeklyPlan.items[${i}]`);
    if (!isString(it['n'])) fail(`weeklyPlan.items[${i}]`, 'n must be a string');
    if (!isOptString(it['q'])) fail(`weeklyPlan.items[${i}]`, 'q must be a string');
    if (!isOptString(it['sec'])) fail(`weeklyPlan.items[${i}]`, 'sec must be a string');
    if (!isOptString(it['store'])) fail(`weeklyPlan.items[${i}]`, 'store must be a string');
    if (!isOptNumber(it['p'])) fail(`weeklyPlan.items[${i}]`, 'p must be a number');
    if (!isOptBoolean(it['warn'])) fail(`weeklyPlan.items[${i}]`, 'warn must be a boolean');
    if (!isOptBoolean(it['staple'])) fail(`weeklyPlan.items[${i}]`, 'staple must be a boolean');
  });

  return o as unknown as GeneratedWeeklyPlanLike;
}

// ---------------------------------------------------------------------------
// Base64 image validation (finding 1.2)
// ---------------------------------------------------------------------------

/** Thrown when the supplied image data is structurally invalid (vs. an API outage). */
export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidImageError';
  }
}

/** Maximum decoded image size accepted (~10 MB). Gemini rejects larger inline payloads. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Minimum plausible base64 payload length (a few bytes of real image data). */
const MIN_BASE64_LENGTH = 16;

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Validates that a base64 (optionally data-URL-prefixed) image string is
 * well-formed and within size limits. Throws {@link InvalidImageError} for
 * structural problems so callers can show an "invalid image" message instead of
 * misattributing the failure to an API outage.
 *
 * @returns the decoded byte length (useful for logging/metrics).
 */
export function validateBase64Image(base64Image: string): number {
  if (typeof base64Image !== 'string' || base64Image.trim().length === 0) {
    throw new InvalidImageError('Image data is empty.');
  }

  // Strip an optional data-URL prefix; reject non-image data URLs explicitly.
  const dataUrlMatch = base64Image.match(/^data:([^;]+);base64,/);
  if (dataUrlMatch && !dataUrlMatch[1]!.startsWith('image/')) {
    throw new InvalidImageError(`Unsupported data URL MIME type: ${dataUrlMatch[1]}`);
  }
  const payload = base64Image.replace(/^data:[^;]+;base64,/, '').trim();

  if (payload.length < MIN_BASE64_LENGTH) {
    throw new InvalidImageError('Image data is too short to be a valid image.');
  }
  if (payload.length % 4 !== 0 || !BASE64_RE.test(payload)) {
    throw new InvalidImageError('Image data is not valid base64.');
  }

  // Estimate decoded size from base64 length (4 chars -> 3 bytes, minus padding).
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  const decodedBytes = (payload.length / 4) * 3 - padding;
  if (decodedBytes > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(
      `Image is too large (${Math.round(decodedBytes / 1024 / 1024)} MB). Max is ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
    );
  }

  return decodedBytes;
}
