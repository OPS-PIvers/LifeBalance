/**
 * Weekly Plan interchange format.
 *
 * Mirrors the `week.json` (schemaVersion 2) contract produced by the
 * companion `weekly-meals` project (https://github.com/OPS-PIvers/weekly-meals).
 * LifeBalance can both GENERATE this shape (via Gemini) and IMPORT it, then
 * render it natively in the Meal Guide and map it into the meal plan +
 * shopping list.
 *
 * Keeping the field names identical to `week.json` means a plan exported from
 * `weekly-meals` drops straight in, and a plan generated here is portable back.
 */

/** A store the groceries are split across (e.g. "Trader Joe's"). */
export interface WeeklyPlanStore {
  name: string;
  why?: string;
}

/**
 * A single prep or cook step. `min` is the WALL-CLOCK minutes the step
 * occupies (required so the scheduler can back-calculate clock times).
 */
export interface WeeklyPlanStep {
  /** Step title, e.g. "Sear the chicken". */
  t: string;
  /** Wall-clock minutes this step occupies. */
  min: number;
  /** Optional detail bullets. */
  det?: string[];
  /** Kid-friendly task (can be delegated). */
  kid?: boolean;
  /** Hands-off (e.g. simmering, smoking) — cook isn't actively working. */
  off?: boolean;
  /** If set, this step starts a timer for N minutes. */
  timer?: number;
}

/** Cross-meal hand-off: an ingredient carried in from / out to another night. */
export interface WeeklyPlanHandoff {
  item: string;
  /** Present on `uses`: the meal this item came from. */
  from?: string;
  /** Present on `saves`: the meal this item is being saved for. */
  to?: string;
}

/** A single dinner in the week. */
export interface WeeklyPlanMeal {
  id?: string;
  cuisine?: string;
  name: string;
  /** "Low" | "Med" | "High". */
  effort?: string;
  /** Active (hands-on) minutes. */
  activeMin?: number;
  /** Default serve time, "HH:MM" (24h). */
  defaultServe?: string;
  servesNote?: string;
  /** One-line italic description. */
  blurb?: string;
  /** Display-form ingredient strings, e.g. "2 lb chicken thighs". */
  ingredients: string[];
  /** Ingredients carried IN from a prior night. */
  uses?: WeeklyPlanHandoff[];
  /** Ingredients saved OUT for a later night. */
  saves?: WeeklyPlanHandoff[];
  prep?: WeeklyPlanStep[];
  cook?: WeeklyPlanStep[];
  leftovers?: string[];
}

/** A consolidated grocery line item. */
export interface WeeklyPlanGroceryItem {
  id?: string;
  /** Name. */
  n: string;
  /** Quantity, e.g. "2 lb". */
  q?: string;
  /** Section: meat | produce | dairy | frozen | pantry | ... */
  sec?: string;
  /** Store key (into `stores`). */
  store?: string;
  /** Price. */
  p?: number;
  note?: string;
  /** Flag for "double-check / substitution" items. */
  warn?: boolean;
  /** Pantry staple the household likely already owns. */
  staple?: boolean;
}

/** A full week of dinners plus its consolidated shopping list. */
export interface WeeklyPlan {
  /** Monday of the week, "YYYY-MM-DD". */
  weekOf: string;
  weekLabel?: string;
  subtitle?: string;
  schemaVersion?: number;
  stores?: Record<string, WeeklyPlanStore>;
  storeOrder?: string[];
  meals: WeeklyPlanMeal[];
  items: WeeklyPlanGroceryItem[];
}

/** Constraints that steer Gemini when generating a plan. */
export interface WeeklyPlanConstraints {
  /** People to cook for (drives serving sizes / leftovers). */
  servings?: number;
  /** Number of dinners to plan (default 3). */
  dinners?: number;
  /** Hard allergies to avoid in every form (e.g. ["apple"]). */
  allergies?: string[];
  /** Softer dietary restrictions/preferences to honor (e.g. ["vegetarian"]). F-MEALS-03. */
  restrictions?: string[];
  /** Foods/cuisines to never propose. */
  outList?: string[];
  /** Reliable favorites to draw from. */
  inList?: string[];
  /** Stores groceries can be split across. */
  stores?: string[];
  /** Free-text steer, e.g. "use up the ground beef in the fridge". */
  note?: string;
  /** Names of recently cooked meals to avoid repeating. */
  recentMeals?: string[];
}
