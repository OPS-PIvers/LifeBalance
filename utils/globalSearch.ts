import type { Habit, Meal, MerchantRule, ShoppingItem, Transaction, ToDo } from '@/types/schema';
import { displayMerchant, merchantSearchTerms } from '@/utils/merchantRules';
import {
  isModuleEnabled,
  isPlanTabVisible,
  type HiddenKeys,
  type ModuleSettings,
} from '@/utils/moduleVisibility';

export type GlobalSearchEntityType = 'transaction' | 'habit' | 'meal' | 'todo' | 'shopping';

/**
 * Where selecting a result navigates. `/budget` and `/habits` use the
 * `useDeepLinkTab` convention (`state: { tab }`); `/lists` has no such param —
 * the target tab is instead seeded into the `lists-active-tab` localStorage
 * key before navigating, mirroring `PlanTabRedirect`. None of the four target
 * pages support filtering to a single record (see Spike notes in
 * advisor-plans/14-global-search-spike.md), so every target is page/tab-level,
 * not record-level — a known v1 gap.
 */
export interface GlobalSearchNavTarget {
  path: '/budget' | '/habits' | '/lists';
  /** `state.tab` for `/budget` and `/habits` deep-links (see `useDeepLinkTab`). */
  tab?: string;
  /** `lists-active-tab` value to seed before navigating to `/lists`. */
  listsTab?: 'todos' | 'meals' | 'shopping';
}

export interface GlobalSearchResult {
  type: GlobalSearchEntityType;
  id: string;
  title: string;
  subtitle?: string;
  nav: GlobalSearchNavTarget;
}

/** The in-memory corpus a search runs over — one array per searchable entity. */
export interface GlobalSearchCorpus {
  transactions: Transaction[];
  habits: Habit[];
  meals: Meal[];
  todos: ToDo[];
  shoppingItems: ShoppingItem[];
}

/**
 * Whether a given entity type's results should be shown, matching
 * `ModuleRoute`'s actual page-visibility logic (`components/auth/ModuleRoute.tsx`):
 * meals/todos/shopping live on `/lists` sub-tabs gated by BOTH the `lists`
 * master toggle and their own tab flag (`isPlanTabVisible`), not just their
 * own flag — a search result must not outlive the page it deep-links to.
 * `hidden` adds the member's own 2F.1 `hiddenKeys` layer on top.
 */
function isEntityVisible(
  type: GlobalSearchEntityType,
  settings: ModuleSettings,
  hidden?: HiddenKeys
): boolean {
  switch (type) {
    case 'transaction':
      return isModuleEnabled(settings, 'money', hidden);
    case 'habit':
      return isModuleEnabled(settings, 'habits', hidden);
    case 'meal':
      return isPlanTabVisible(settings, 'meals', hidden);
    case 'todo':
      return isPlanTabVisible(settings, 'todos', hidden);
    case 'shopping':
      return isPlanTabVisible(settings, 'shopping', hidden);
  }
}

const MAX_PER_TYPE = 5;
const MAX_TOTAL = 20;

/**
 * Ranks how well `text` matches `query` (both compared case-insensitively).
 * Lower is better. Returns `null` on no match.
 *   0 — exact prefix (text starts with the query)
 *   1 — word-boundary (some token in text starts with the query)
 *   2 — plain substring
 * Mirrors `TransactionMasterList`'s case-insensitive `.includes()` filtering
 * rather than adding a fuzzy-match dependency.
 */
function matchRank(text: string, queryLower: string): number | null {
  if (!text) return null;
  const textLower = text.toLowerCase();
  if (textLower.startsWith(queryLower)) return 0;
  const tokens = textLower.split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.some((token) => token.startsWith(queryLower))) return 1;
  if (textLower.includes(queryLower)) return 2;
  return null;
}

/** Best (lowest) rank across several candidate fields, or `null` if none match. */
function bestRank(queryLower: string, ...fields: (string | undefined)[]): number | null {
  let best: number | null = null;
  for (const field of fields) {
    if (!field) continue;
    const rank = matchRank(field, queryLower);
    if (rank !== null && (best === null || rank < best)) {
      best = rank;
    }
  }
  return best;
}

interface RankedResult extends GlobalSearchResult {
  rank: number;
}

/**
 * `rules` (optional) widens merchant matching to BOTH spellings of the row —
 * the raw bank descriptor and the household's friendly name — via
 * `merchantSearchTerms`. A user must be able to find a purchase by whichever
 * name they remember; renaming a merchant must never hide it from search.
 * Omitting `rules` yields exactly the raw-descriptor-only behaviour, since
 * `merchantSearchTerms` always includes the raw merchant and adds nothing else
 * when no rule matches.
 *
 * The result `title` carries the FRIENDLY name (falling back to the raw
 * descriptor when no rule renames it), even when the hit came from matching the
 * raw text. A search result is a rendered label like any other, so showing
 * `APPLE.COM/BILL 866-712-7753 CA` for a row the household named "iCloud
 * storage" would contradict every other surface — and defeat the feature at the
 * one moment the user is actively looking for that purchase. Matching stays
 * wider than display on purpose: both spellings find it, one spelling shows.
 */
function searchTransactions(
  transactions: Transaction[],
  queryLower: string,
  rules?: readonly MerchantRule[]
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const tx of transactions) {
    const rank = bestRank(queryLower, ...merchantSearchTerms(tx, rules), tx.category);
    if (rank === null) continue;
    results.push({
      type: 'transaction',
      id: tx.id,
      title: displayMerchant(tx, rules),
      subtitle: tx.category || undefined,
      nav: { path: '/budget', tab: 'transactions' },
      rank,
    });
  }
  return results;
}

function searchHabits(habits: Habit[], queryLower: string): RankedResult[] {
  const results: RankedResult[] = [];
  for (const habit of habits) {
    const rank = bestRank(queryLower, habit.title, habit.category);
    if (rank === null) continue;
    results.push({
      type: 'habit',
      id: habit.id,
      title: habit.title,
      subtitle: habit.category || undefined,
      nav: { path: '/habits', tab: 'track' },
      rank,
    });
  }
  return results;
}

function searchMeals(meals: Meal[], queryLower: string): RankedResult[] {
  const results: RankedResult[] = [];
  for (const meal of meals) {
    const rank = bestRank(queryLower, meal.name, ...meal.tags);
    if (rank === null) continue;
    results.push({
      type: 'meal',
      id: meal.id,
      title: meal.name,
      subtitle: meal.tags.length > 0 ? meal.tags.join(', ') : undefined,
      nav: { path: '/lists', listsTab: 'meals' },
      rank,
    });
  }
  return results;
}

function searchTodos(todos: ToDo[], queryLower: string): RankedResult[] {
  const results: RankedResult[] = [];
  for (const todo of todos) {
    const rank = bestRank(queryLower, todo.text);
    if (rank === null) continue;
    results.push({
      type: 'todo',
      id: todo.id,
      title: todo.text,
      subtitle: todo.completeByDate ? `Due ${todo.completeByDate}` : undefined,
      nav: { path: '/lists', listsTab: 'todos' },
      rank,
    });
  }
  return results;
}

function searchShoppingItems(items: ShoppingItem[], queryLower: string): RankedResult[] {
  const results: RankedResult[] = [];
  for (const item of items) {
    const rank = bestRank(queryLower, item.name, item.category);
    if (rank === null) continue;
    results.push({
      type: 'shopping',
      id: item.id,
      title: item.name,
      subtitle: item.category || undefined,
      nav: { path: '/lists', listsTab: 'shopping' },
      rank,
    });
  }
  return results;
}

/**
 * Pure client-side search over the in-memory household corpus. Empty/blank
 * query returns no results. Results are capped per type (`MAX_PER_TYPE`) and
 * overall (`MAX_TOTAL`), ranked exact-prefix > word-boundary > substring
 * (see `matchRank`). A type is excluded entirely when its gating module is
 * disabled — by the household (`moduleVisibility`) or by this member
 * (`hiddenKeys`, 2F.1): a result must never outlive the page it deep-links to.
 *
 * `rules` is the household's merchant rules (optional): when supplied, a
 * transaction matches on its raw bank descriptor OR its friendly name. Omit it
 * (or pass an empty array) and search behaves exactly as it did before merchant
 * rules existed.
 */
export function searchAll(
  corpus: GlobalSearchCorpus,
  query: string,
  moduleSettings: ModuleSettings,
  rules?: readonly MerchantRule[],
  hidden?: HiddenKeys
): GlobalSearchResult[] {
  const queryLower = query.trim().toLowerCase();
  if (!queryLower) return [];

  const byType: Partial<Record<GlobalSearchEntityType, RankedResult[]>> = {
    transaction: searchTransactions(corpus.transactions, queryLower, rules),
    habit: searchHabits(corpus.habits, queryLower),
    meal: searchMeals(corpus.meals, queryLower),
    todo: searchTodos(corpus.todos, queryLower),
    shopping: searchShoppingItems(corpus.shoppingItems, queryLower),
  };

  const capped: RankedResult[] = [];
  for (const type of Object.keys(byType) as GlobalSearchEntityType[]) {
    if (!isEntityVisible(type, moduleSettings, hidden)) continue;
    const results = byType[type] ?? [];
    results.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
    capped.push(...results.slice(0, MAX_PER_TYPE));
  }

  capped.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));

  return capped.slice(0, MAX_TOTAL).map(({ rank: _rank, ...result }) => result);
}
