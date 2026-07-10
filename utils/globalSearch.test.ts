import { describe, it, expect } from 'vitest';
import { searchAll, type GlobalSearchCorpus } from '@/utils/globalSearch';
import type { Habit, Meal, ShoppingItem, Transaction, ToDo } from '@/types/schema';

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

  it('returns no results when nothing matches', () => {
    const corpus: GlobalSearchCorpus = { ...emptyCorpus, transactions: [makeTransaction({ merchant: 'Target' })] };
    expect(searchAll(corpus, 'nonexistentquery', undefined)).toEqual([]);
  });
});
