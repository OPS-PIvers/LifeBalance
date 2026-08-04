import { describe, it, expect } from 'vitest';
import { searchAll, SAVED_FOR_LATER_SUBTITLE, type GlobalSearchCorpus } from '@/utils/globalSearch';
import type { Habit, Meal, MerchantRule, ShoppingItem, Transaction, ToDo } from '@/types/schema';

const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  amount: 42,
  merchant: 'Target',
  category: 'Shopping',
  date: '2026-07-01',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...overrides,
});

const makeHabit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'habit-1',
  title: 'Read 30 mins',
  category: 'Wellness',
  type: 'positive',
  basePoints: 10,
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-01',
  ...overrides,
});

const makeMeal = (overrides: Partial<Meal> = {}): Meal => ({
  id: 'meal-1',
  name: 'Taco Tuesday',
  ingredients: [],
  tags: ['favorite'],
  ...overrides,
});

const makeTodo = (overrides: Partial<ToDo> = {}): ToDo => ({
  id: 'todo-1',
  text: 'Take out the trash',
  completeByDate: '2026-07-10',
  assignedTo: 'uid-1',
  isCompleted: false,
  createdBy: 'uid-1',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const makeShoppingItem = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: 'shop-1',
  name: 'Tortillas',
  category: 'Bakery',
  isPurchased: false,
  ...overrides,
});

const emptyCorpus: GlobalSearchCorpus = {
  transactions: [],
  habits: [],
  meals: [],
  todos: [],
  shoppingItems: [],
};

describe('searchAll', () => {
  it('returns no results for an empty or whitespace-only query', () => {
    const corpus: GlobalSearchCorpus = { ...emptyCorpus, transactions: [makeTransaction()] };
    expect(searchAll(corpus, '', undefined)).toEqual([]);
    expect(searchAll(corpus, '   ', undefined)).toEqual([]);
  });

  it('matches case-insensitively', () => {
    const corpus: GlobalSearchCorpus = { ...emptyCorpus, transactions: [makeTransaction({ merchant: 'Target' })] };
    const results = searchAll(corpus, 'target', undefined);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Target');
  });

  it('ranks exact-prefix above word-boundary above substring matches', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      habits: [
        makeHabit({ id: 'h-substring', title: 'Weightlifting practice' }), // "lift" substring only
        makeHabit({ id: 'h-prefix', title: 'Lift weights' }), // "lift" exact prefix
        makeHabit({ id: 'h-boundary', title: 'Daily lift session' }), // "lift" word-boundary
      ],
    };
    const results = searchAll(corpus, 'lift', undefined);
    expect(results.map((r) => r.id)).toEqual(['h-prefix', 'h-boundary', 'h-substring']);
  });

  it('matches a transaction by category as well as merchant', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      transactions: [makeTransaction({ merchant: 'Costco', category: 'Groceries' })],
    };
    const results = searchAll(corpus, 'grocer', undefined);
    expect(results).toHaveLength(1);
    expect(results[0]?.subtitle).toBe('Groceries');
  });

  it('matches a meal by tag', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      meals: [makeMeal({ name: 'Chili', tags: ['quick', 'cheap'] })],
    };
    const results = searchAll(corpus, 'cheap', undefined);
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe('Chili');
  });

  it('caps results per type at 5', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      todos: Array.from({ length: 8 }, (_, i) => makeTodo({ id: `todo-${i}`, text: `Buy milk ${i}` })),
    };
    const results = searchAll(corpus, 'milk', undefined);
    expect(results).toHaveLength(5);
  });

  it('caps total results at 20 across types', () => {
    const corpus: GlobalSearchCorpus = {
      transactions: Array.from({ length: 5 }, (_, i) => makeTransaction({ id: `tx-${i}`, merchant: `Zebra Mart ${i}` })),
      habits: Array.from({ length: 5 }, (_, i) => makeHabit({ id: `h-${i}`, title: `Zebra habit ${i}` })),
      meals: Array.from({ length: 5 }, (_, i) => makeMeal({ id: `m-${i}`, name: `Zebra meal ${i}` })),
      todos: Array.from({ length: 5 }, (_, i) => makeTodo({ id: `t-${i}`, text: `Zebra todo ${i}` })),
      shoppingItems: Array.from({ length: 5 }, (_, i) => makeShoppingItem({ id: `s-${i}`, name: `Zebra item ${i}` })),
    };
    const results = searchAll(corpus, 'zebra', undefined);
    expect(results).toHaveLength(20);
  });

  it('excludes a disabled module entirely', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      transactions: [makeTransaction({ merchant: 'Target' })],
      habits: [makeHabit({ title: 'Target practice' })],
    };
    const results = searchAll(corpus, 'target', {
      moduleVisibility: { money: false },
    });
    expect(results.every((r) => r.type !== 'transaction')).toBe(true);
    expect(results.some((r) => r.type === 'habit')).toBe(true);
  });

  it('excludes todo/meal/shopping results when the plan master toggle is off, even if their own flag is not false', () => {
    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      todos: [makeTodo({ text: 'Target chore' })],
      meals: [makeMeal({ name: 'Target dinner' })],
      shoppingItems: [makeShoppingItem({ name: 'Target item' })],
    };
    // Mirrors ModuleRoute/isPlanTabVisible: `plan` off hides every sub-tab
    // regardless of the individual todos/meals/shopping flags.
    const results = searchAll(corpus, 'target', { moduleVisibility: { plan: false } });
    expect(results).toEqual([]);
  });

  it('is fail-open when moduleVisibility is absent (every module enabled)', () => {
    const corpus: GlobalSearchCorpus = { ...emptyCorpus, transactions: [makeTransaction({ merchant: 'Target' })] };
    const results = searchAll(corpus, 'target', null);
    expect(results).toHaveLength(1);
  });

  it('sets the correct nav target per entity type', () => {
    const corpus: GlobalSearchCorpus = {
      transactions: [makeTransaction({ merchant: 'Target' })],
      habits: [makeHabit({ title: 'Target' })],
      meals: [makeMeal({ name: 'Target' })],
      todos: [makeTodo({ text: 'Target' })],
      shoppingItems: [makeShoppingItem({ name: 'Target' })],
    };
    const results = searchAll(corpus, 'target', undefined);
    const byType = Object.fromEntries(results.map((r) => [r.type, r.nav]));
    expect(byType.transaction).toEqual({ path: '/budget', tab: 'transactions' });
    expect(byType.habit).toEqual({ path: '/habits', tab: 'track' });
    expect(byType.meal).toEqual({ path: '/lists', listsTab: 'meals' });
    expect(byType.todo).toEqual({ path: '/lists', listsTab: 'todos' });
    expect(byType.shopping).toEqual({ path: '/lists', listsTab: 'shopping' });
  });

  /**
   * 2F.1 — the member layer. Every entity type is gated on the SPECIFIC leaf its
   * nav target deep-links to, not on its page merely still having some reachable
   * view. Gating at page level let a member who hid only Money → Transactions
   * keep seeing transaction results whose `{ tab: 'transactions' }` target
   * `resolveActiveLocation` then rewrote to a different Money view — selecting a
   * result landed somewhere else than what was searched for.
   */
  describe('member hiddenKeys (leaf-level gating)', () => {
    const everyType: GlobalSearchCorpus = {
      transactions: [makeTransaction({ merchant: 'Target' })],
      habits: [makeHabit({ title: 'Target' })],
      meals: [makeMeal({ name: 'Target' })],
      todos: [makeTodo({ text: 'Target' })],
      shoppingItems: [makeShoppingItem({ name: 'Target' })],
    };
    const types = (hidden?: string[]) =>
      searchAll(everyType, 'target', undefined, undefined, hidden).map((r) => r.type).sort();

    it('shows every type for a member who has hidden nothing', () => {
      expect(types()).toEqual(['habit', 'meal', 'shopping', 'todo', 'transaction']);
      expect(types([])).toEqual(['habit', 'meal', 'shopping', 'todo', 'transaction']);
    });

    it("excludes transactions when only Money's Transactions leaf is hidden", () => {
      // Money itself is still reachable (six other leaves) — page-level gating
      // would wrongly keep these results.
      expect(types(['transactions'])).not.toContain('transaction');
      expect(types(['transactions'])).toContain('habit');
    });

    it("excludes habits when only Habits' Track leaf is hidden", () => {
      expect(types(['track'])).not.toContain('habit');
      expect(types(['track'])).toContain('transaction');
    });

    it('leaves a type alone when a SIBLING leaf on its page is hidden', () => {
      // Hiding Trends/History must not touch the transaction/habit results,
      // whose targets are still reachable.
      expect(types(['trends', 'history'])).toEqual([
        'habit',
        'meal',
        'shopping',
        'todo',
        'transaction',
      ]);
    });

    it('excludes each Lists type when its own sub-tab is hidden', () => {
      expect(types(['meals'])).not.toContain('meal');
      expect(types(['todos'])).not.toContain('todo');
      expect(types(['shopping'])).not.toContain('shopping');
    });

    it('composes with the household layer (either one hides the type)', () => {
      const hiddenByHousehold = searchAll(
        everyType,
        'target',
        { moduleVisibility: { money: false } },
        undefined,
        [],
      );
      expect(hiddenByHousehold.every((r) => r.type !== 'transaction')).toBe(true);
    });
  });

  it('returns no results when nothing matches', () => {
    const corpus: GlobalSearchCorpus = { ...emptyCorpus, transactions: [makeTransaction({ merchant: 'Target' })] };
    expect(searchAll(corpus, 'nonexistentquery', undefined)).toEqual([]);
  });

  /**
   * "Saved for later" (PR-5) — parked to-dos/shopping items are excluded from
   * the default `todos`/`shoppingItems` slices (see `contexts/
   * FirebaseHouseholdContext.tsx`), so search must draw them from the
   * dedicated `savedForLaterTodos`/`savedForLaterShopping` corpus fields or
   * they're unfindable entirely.
   */
  describe('saved for later', () => {
    it('finds a parked to-do via savedForLaterTodos', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        savedForLaterTodos: [makeTodo({ id: 'todo-parked', text: 'Repaint the fence' })],
      };
      const results = searchAll(corpus, 'repaint', undefined);
      expect(results.map((r) => r.id)).toEqual(['todo-parked']);
    });

    it('finds a parked shopping item via savedForLaterShopping', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked', name: 'Cast iron skillet' })],
      };
      const results = searchAll(corpus, 'skillet', undefined);
      expect(results.map((r) => r.id)).toEqual(['shop-parked']);
    });

    it('labels a parked to-do result "Saved for later" instead of its (placeholder) due date', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        // A parked to-do still carries a completeByDate — an inert placeholder
        // that must never render (see ToDo.savedForLater). The subtitle must
        // show the parked label, not `Due 2026-08-04`.
        savedForLaterTodos: [makeTodo({ id: 'todo-parked', text: 'Repaint the fence', completeByDate: '2026-08-04' })],
      };
      const results = searchAll(corpus, 'repaint', undefined);
      expect(results[0]?.subtitle).toBe(SAVED_FOR_LATER_SUBTITLE);
      expect(results[0]?.subtitle).toBe('Saved for later');
    });

    it('labels a parked shopping item result "Saved for later" instead of its category', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked', name: 'Cast iron skillet', category: 'Kitchen' })],
      };
      const results = searchAll(corpus, 'skillet', undefined);
      expect(results[0]?.subtitle).toBe(SAVED_FOR_LATER_SUBTITLE);
    });

    it('does not label an active (non-parked) result as saved for later', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        todos: [makeTodo({ id: 'todo-active', text: 'Repaint the fence', completeByDate: '2026-08-04' })],
      };
      const results = searchAll(corpus, 'repaint', undefined);
      expect(results[0]?.subtitle).toBe('Due 2026-08-04');
    });

    it('sets the same /lists nav target for a parked to-do/shopping item as their active equivalents', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        savedForLaterTodos: [makeTodo({ id: 'todo-parked', text: 'Repaint' })],
        savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked', name: 'Repaint brush' })],
      };
      const results = searchAll(corpus, 'repaint', undefined);
      const byId = Object.fromEntries(results.map((r) => [r.id, r.nav]));
      expect(byId['todo-parked']).toEqual({ path: '/lists', listsTab: 'todos' });
      expect(byId['shop-parked']).toEqual({ path: '/lists', listsTab: 'shopping' });
    });

    /**
     * The gating case: a parked item is gated on the SAME leaf as its active
     * equivalent (`isNavLeafKeyVisible`/`isPlanTabVisible` via
     * `isEntityVisible`), not exempted from it. This test would FAIL if the
     * gate were removed or if parked items bypassed `isEntityVisible`.
     */
    it('hides parked results when their leaf is hidden, exactly like active results', () => {
      const corpus: GlobalSearchCorpus = {
        ...emptyCorpus,
        savedForLaterTodos: [makeTodo({ id: 'todo-parked', text: 'Repaint the fence' })],
        savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked', name: 'Repaint brush' })],
      };

      // Baseline: visible with nothing hidden.
      expect(searchAll(corpus, 'repaint', undefined).map((r) => r.id).sort()).toEqual(
        ['shop-parked', 'todo-parked']
      );

      // Member hides the To-Dos leaf → the parked to-do (not just active
      // to-dos) disappears; the parked shopping item is untouched.
      const todosHidden = searchAll(corpus, 'repaint', undefined, undefined, ['todos']);
      expect(todosHidden.map((r) => r.id)).toEqual(['shop-parked']);

      // Member hides the Shopping leaf → the parked shopping item disappears;
      // the parked to-do is untouched.
      const shoppingHidden = searchAll(corpus, 'repaint', undefined, undefined, ['shopping']);
      expect(shoppingHidden.map((r) => r.id)).toEqual(['todo-parked']);

      // Household disables the `lists` master toggle → both parked types
      // disappear, mirroring the existing plan-toggle test for active items.
      const listsDisabled = searchAll(corpus, 'repaint', { moduleVisibility: { plan: false } });
      expect(listsDisabled).toEqual([]);
    });

    /**
     * `searchAll` merges an active array and a parked array per type
     * (`[...searchTodos(active), ...searchTodos(parked, true)]`) and then
     * rank-sorts the combined list. Every other "saved for later" test above
     * uses an all-active or all-parked corpus, so this rank-based ordering —
     * the merge output isn't just concatenated, the better match wins
     * regardless of which array it came from — is only exercised here. Both
     * fixtures below give the two rows DIFFERENT match ranks (one is an
     * exact-prefix match, rank 0; the other only a word-boundary match, rank
     * 1) so the assertion is decided purely by rank, never by a title
     * tie-break, and reads correctly under a stable sort regardless of merge
     * order.
     *
     * Two directions are required together: alone, "parked ranks first when
     * it's the better match" would still pass under a broken implementation
     * that unconditionally put parked results ahead of active ones; alone,
     * "active ranks first when it's the better match" would still pass under
     * one that unconditionally put active results first. Only the pair rules
     * out both naive bugs.
     */
    describe('mixed active + parked ranking', () => {
      it('ranks a closer-matching PARKED to-do ahead of a weaker-matching ACTIVE one', () => {
        const corpus: GlobalSearchCorpus = {
          ...emptyCorpus,
          // Exact-prefix match (rank 0).
          savedForLaterTodos: [makeTodo({ id: 'todo-parked-closer', text: 'Fence repair estimate' })],
          // Word-boundary match only (rank 1): "fence" appears as a whole
          // token but the text doesn't START with the query.
          todos: [makeTodo({ id: 'todo-active-farther', text: 'Ask about the fence contractor' })],
        };
        const results = searchAll(corpus, 'fence', undefined);
        expect(results.map((r) => r.id)).toEqual(['todo-parked-closer', 'todo-active-farther']);
      });

      it('ranks a closer-matching ACTIVE to-do ahead of a weaker-matching PARKED one', () => {
        const corpus: GlobalSearchCorpus = {
          ...emptyCorpus,
          // Exact-prefix match (rank 0).
          todos: [makeTodo({ id: 'todo-active-closer', text: 'Fence repair estimate' })],
          // Word-boundary match only (rank 1).
          savedForLaterTodos: [makeTodo({ id: 'todo-parked-farther', text: 'Ask about the fence contractor' })],
        };
        const results = searchAll(corpus, 'fence', undefined);
        expect(results.map((r) => r.id)).toEqual(['todo-active-closer', 'todo-parked-farther']);
      });

      it('ranks a closer-matching PARKED shopping item ahead of a weaker-matching ACTIVE one', () => {
        const corpus: GlobalSearchCorpus = {
          ...emptyCorpus,
          savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked-closer', name: 'Fence paint' })],
          shoppingItems: [makeShoppingItem({ id: 'shop-active-farther', name: 'Ask about fence paint options' })],
        };
        const results = searchAll(corpus, 'fence', undefined);
        expect(results.map((r) => r.id)).toEqual(['shop-parked-closer', 'shop-active-farther']);
      });

      it('ranks a closer-matching ACTIVE shopping item ahead of a weaker-matching PARKED one', () => {
        const corpus: GlobalSearchCorpus = {
          ...emptyCorpus,
          shoppingItems: [makeShoppingItem({ id: 'shop-active-closer', name: 'Fence paint' })],
          savedForLaterShopping: [makeShoppingItem({ id: 'shop-parked-farther', name: 'Ask about fence paint options' })],
        };
        const results = searchAll(corpus, 'fence', undefined);
        expect(results.map((r) => r.id)).toEqual(['shop-active-closer', 'shop-parked-farther']);
      });
    });
  });

  describe('merchant rules', () => {
    const makeRule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
      id: 'rule-1',
      pattern: 'SQ *BLUE BOTTLE',
      name: 'Coffee run',
      createdAt: '2026-07-01T00:00:00.000Z',
      ...overrides,
    });

    const corpus: GlobalSearchCorpus = {
      ...emptyCorpus,
      transactions: [makeTransaction({ id: 'tx-coffee', merchant: 'SQ *BLUE BOTTLE', category: 'Dining' })],
    };

    it('finds a renamed row by its friendly name', () => {
      const results = searchAll(corpus, 'coffee', undefined, [makeRule()]);
      expect(results.map((r) => r.id)).toEqual(['tx-coffee']);
    });

    it('still finds the same row by its raw bank descriptor', () => {
      const results = searchAll(corpus, 'blue bottle', undefined, [makeRule()]);
      expect(results.map((r) => r.id)).toEqual(['tx-coffee']);
    });

    it('titles the result with the friendly name', () => {
      const results = searchAll(corpus, 'coffee', undefined, [makeRule()]);
      expect(results[0]?.title).toBe('Coffee run');
    });

    it('titles the result with the friendly name even when found by the raw descriptor', () => {
      // Matching is deliberately wider than display: either spelling finds the
      // row, but it always presents under the name the household chose.
      const results = searchAll(corpus, 'blue bottle', undefined, [makeRule()]);
      expect(results[0]?.title).toBe('Coffee run');
    });

    it('falls back to the raw descriptor when the matching rule sets no name', () => {
      const results = searchAll(corpus, 'blue bottle', undefined, [
        makeRule({ name: undefined, category: 'Dining' }),
      ]);
      expect(results[0]?.title).toBe('SQ *BLUE BOTTLE');
    });

    it('does not find the friendly name when rules are omitted or empty', () => {
      expect(searchAll(corpus, 'coffee', undefined)).toEqual([]);
      expect(searchAll(corpus, 'coffee', undefined, [])).toEqual([]);
    });

    it('is byte-identical to the no-rules result when no rule matches the row', () => {
      // The regression gate: a household whose rules don't touch this merchant
      // must get exactly the pre-feature result, title included.
      const unrelated = makeRule({ id: 'r-other', pattern: 'APPLE.COM', name: 'Apple' });
      expect(searchAll(corpus, 'blue', undefined, [unrelated]))
        .toEqual(searchAll(corpus, 'blue', undefined));
    });

    it('is byte-identical to the no-rules result when rules are omitted or empty', () => {
      const baseline = searchAll(corpus, 'blue', undefined);
      expect(searchAll(corpus, 'blue', undefined, [])).toEqual(baseline);
    });

    it('reports one result, not two, when the query matches both spellings', () => {
      // "bottle" is in the descriptor; the friendly name here repeats it, so a
      // naive per-term push would emit the row twice.
      const results = searchAll(corpus, 'bottle', undefined, [
        makeRule({ name: 'Blue Bottle coffee' }),
      ]);
      expect(results).toHaveLength(1);
    });

    it('resolves an amount-qualified rule against the row amount', () => {
      const subscription: GlobalSearchCorpus = {
        ...emptyCorpus,
        transactions: [makeTransaction({ id: 'tx-icloud', merchant: 'APPLE.COM/BILL', amount: 2.99 })],
      };
      const rules = [makeRule({ pattern: 'APPLE.COM', name: 'iCloud storage', amount: 2.99 })];

      expect(searchAll(subscription, 'icloud', undefined, rules).map((r) => r.id)).toEqual(['tx-icloud']);
      // Same rule, wrong amount → the friendly name does not apply.
      const oneOff: GlobalSearchCorpus = {
        ...emptyCorpus,
        transactions: [makeTransaction({ merchant: 'APPLE.COM/BILL', amount: 79 })],
      };
      expect(searchAll(oneOff, 'icloud', undefined, rules)).toEqual([]);
    });
  });
});
