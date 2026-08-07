/**
 * Unit tests for the habit category mutations — the habit twins of
 * `todoCategoryMutations.test.ts`, mirroring its cases so the two paths can be
 * compared line for line.
 *
 * `firebase/firestore` is mocked locally (same convention as the to-do suite) so
 * these are pure logic tests: refs carry their `__path`, each `writeBatch`
 * records its own ops, and `getDocs` is driven with fake habit docs. Covers the
 * chunking boundary, case-insensitive matching, the merge-on-collision rule, the
 * REASSIGN-on-delete rule (habits cannot be left category-less — see
 * utils/habitCategories.ts), the no-op guards, and the rethrow contract (these
 * mutations toast nothing and re-throw, so callers can't report success for a
 * write that never landed).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeHabitCategoryEditMutations } from './habitCategoryMutations';
import { FIRESTORE_BATCH_LIMIT } from './todoMutations';
import { UNCATEGORIZED_HABIT_CATEGORY } from '@/utils/habitCategories';
import type { Habit } from '@/types/schema';

interface Ref { __path: string; withConverter: (c: unknown) => Ref }
interface BatchRecord { ops: Array<{ ref: Ref; data: Record<string, unknown> }> }

const batches: BatchRecord[] = [];
const commitMock = vi.fn(async () => {});
const updateDocMock = vi.fn(async () => {});
const getDocsDocs = { current: [] as Habit[] };

vi.mock('firebase/firestore', () => {
  const makeRef = (path: string): Record<string, unknown> => ({
    __path: path,
    withConverter: () => makeRef(path),
  });
  return {
    doc: vi.fn((_db: unknown, path: string, id?: string) => makeRef(id ? `${path}/${id}` : path)),
    collection: vi.fn((_db: unknown, path: string) => makeRef(path)),
    getDoc: vi.fn(),
    getDocs: vi.fn(async () => ({
      docs: getDocsDocs.current.map(h => ({
        ref: makeRef(`households/hh-1/habits/${h.id}`),
        data: () => h,
      })),
    })),
    addDoc: vi.fn(),
    updateDoc: (...args: unknown[]) => updateDocMock(...(args as [])),
    deleteDoc: vi.fn(),
    deleteField: vi.fn(() => ({ __deleteField: true })),
    query: vi.fn((col: unknown, ..._clauses: unknown[]) => col),
    where: vi.fn(),
    orderBy: vi.fn((field: string) => ({ __orderBy: field })),
    limit: vi.fn(),
    startAfter: vi.fn(),
    increment: vi.fn((n: number) => ({ __increment: n })),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    writeBatch: vi.fn(() => {
      const record: BatchRecord = { ops: [] };
      batches.push(record);
      return {
        update: (ref: Ref, data: Record<string, unknown>) => { record.ops.push({ ref, data }); },
        set: vi.fn(),
        delete: vi.fn(),
        commit: () => commitMock(),
      };
    }),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp'),
    Timestamp: class {},
  };
});

// `vi.mock` factories are hoisted above module-scope consts, so the toast spies
// have to be hoisted too if the tests want to assert on them.
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), toastMock),
}));

const db = {} as never;
const householdId = 'hh-1';

const habit = (id: string, category: string): Habit => ({
  id,
  title: id,
  category,
  type: 'positive',
  basePoints: 10,
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: '2026-07-01T00:00:00.000Z',
});

beforeEach(() => {
  batches.length = 0;
  getDocsDocs.current = [];
  commitMock.mockClear();
  updateDocMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
});

const categoryUpdates = () =>
  batches.flatMap(b => b.ops.map(op => ({ id: op.ref.__path.split('/').pop(), data: op.data })));

const make = (habitCategories: string[]) =>
  makeHabitCategoryEditMutations({ db, householdId, habitCategories });

describe('renameHabitCategory', () => {
  it('rewrites every matching habit (including archived ones) and updates the list', async () => {
    getDocsDocs.current = [
      habit('a', 'Health'),
      { ...habit('b', 'Health'), archivedAt: '2026-06-01T00:00:00.000Z' },
      habit('c', 'Work'),
    ];
    await make(['Health', 'Work']).renameHabitCategory('Health', 'Wellbeing');

    expect(categoryUpdates()).toEqual([
      { id: 'a', data: { category: 'Wellbeing' } },
      { id: 'b', data: { category: 'Wellbeing' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Wellbeing', 'Work'] });
  });

  it('matches case-insensitively so a typo fix actually rewrites habits', async () => {
    getDocsDocs.current = [habit('a', 'health'), habit('b', 'HEALTH')];
    await make(['health']).renameHabitCategory('health', 'Health');

    expect(categoryUpdates()).toEqual([
      { id: 'a', data: { category: 'Health' } },
      { id: 'b', data: { category: 'Health' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Health'] });
  });

  it('MERGES into an existing category rather than creating a case-variant duplicate', async () => {
    getDocsDocs.current = [habit('a', 'Fitness'), habit('b', 'Health')];
    await make(['Fitness', 'Health']).renameHabitCategory('Fitness', 'health');

    // Habits adopt the EXISTING spelling, not the typed one.
    expect(categoryUpdates()).toEqual([{ id: 'a', data: { category: 'Health' } }]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Health'] });
  });

  // The NORMAL case for habits, not an edge one: `habitCategories` was
  // append-only and never recorded several categories real habits use, which is
  // the whole reason the vocabulary is derived rather than read (see
  // utils/habitCategories.ts). Renaming one of those must still land it in the
  // stored list.
  it('adds the target to the list when the old name lived only on habits', async () => {
    getDocsDocs.current = [habit('a', 'Food & Nutrition')];
    await make(['Health']).renameHabitCategory('Food & Nutrition', 'Nutrition');

    expect(categoryUpdates()).toEqual([{ id: 'a', data: { category: 'Nutrition' } }]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Health', 'Nutrition'] });
  });

  it('chunks the rewrites into 500-op batches', async () => {
    getDocsDocs.current = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) =>
      habit(`h${i}`, 'Health'),
    );
    await make(['Health']).renameHabitCategory('Health', 'Wellbeing');

    expect(batches).toHaveLength(2);
    expect(batches[0]?.ops).toHaveLength(FIRESTORE_BATCH_LIMIT);
    expect(batches[1]?.ops).toHaveLength(1);
    expect(commitMock).toHaveBeenCalledTimes(2);
  });

  it('RE-THROWS when the vocabulary write fails, and toasts nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocsDocs.current = [habit('a', 'Health')];
    updateDocMock.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(make(['Health']).renameHabitCategory('Health', 'Wellbeing')).rejects.toThrow(
      'permission-denied',
    );
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  // The mutation's doc comment claims a part-way failure is safe to retry
  // because the habit rewrites commit BEFORE the vocabulary list. This is that
  // claim, executed: the failed run leaves the old name listed, and the retry
  // re-queries by the old name so it only touches what is left.
  it('converges on retry when one chunk of the rewrite fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const all = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) => habit(`h${i}`, 'Health'));
    getDocsDocs.current = all;
    // First chunk commits, second is rejected.
    commitMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('unavailable'));

    await expect(make(['Health']).renameHabitCategory('Health', 'Wellbeing')).rejects.toThrow(
      'unavailable',
    );
    // Vocabulary untouched — 'Health' is still listed, so the habits the first
    // chunk did NOT reach are still reachable through the UI.
    expect(updateDocMock).not.toHaveBeenCalled();

    // Retry: Firestore now only returns the habits still carrying 'Health' (the
    // first chunk was rewritten to 'Wellbeing' and no longer matches).
    batches.length = 0;
    commitMock.mockClear();
    getDocsDocs.current = all.slice(FIRESTORE_BATCH_LIMIT);
    await make(['Health']).renameHabitCategory('Health', 'Wellbeing');

    expect(batches).toHaveLength(1);
    expect(batches[0]?.ops).toHaveLength(1);
    expect(categoryUpdates()).toEqual([
      { id: `h${FIRESTORE_BATCH_LIMIT}`, data: { category: 'Wellbeing' } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Wellbeing'] });
    errorSpy.mockRestore();
  });

  it('is a no-op for a blank new name, an unchanged name, or no household', async () => {
    getDocsDocs.current = [habit('a', 'Health')];
    await make(['Health']).renameHabitCategory('Health', '   ');
    await make(['Health']).renameHabitCategory('Health', 'Health');
    await makeHabitCategoryEditMutations({ db, householdId: null, habitCategories: ['Health'] })
      .renameHabitCategory('Health', 'Wellbeing');

    expect(batches).toHaveLength(0);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

describe('deleteHabitCategory', () => {
  // 🛡️ The habit path DIVERGES from deleteTodoCategory here: `Habit.category` is
  // required (firestore.rules rejects an empty one, and pages/Habits.tsx groups
  // by the raw string), so the habits are REASSIGNED rather than cleared.
  it('reassigns matching habits to Uncategorized and drops the list entry', async () => {
    getDocsDocs.current = [
      habit('a', 'Health'),
      { ...habit('b', 'health'), archivedAt: '2026-06-01T00:00:00.000Z' },
      habit('c', 'Work'),
    ];
    await make(['Health', 'Work']).deleteHabitCategory('Health');

    expect(categoryUpdates()).toEqual([
      { id: 'a', data: { category: UNCATEGORIZED_HABIT_CATEGORY } },
      { id: 'b', data: { category: UNCATEGORIZED_HABIT_CATEGORY } },
    ]);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Work'] });
  });

  it('never writes an empty category, so every habit stays valid under firestore.rules', async () => {
    getDocsDocs.current = [habit('a', 'Health')];
    await make(['Health']).deleteHabitCategory('Health');

    for (const update of categoryUpdates()) {
      expect(update.data['category']).toBeTypeOf('string');
      expect(update.data['category']).not.toBe('');
    }
  });

  it('deleting Uncategorized itself only drops the list entry (no no-op habit writes)', async () => {
    getDocsDocs.current = [habit('a', UNCATEGORIZED_HABIT_CATEGORY)];
    await make([UNCATEGORIZED_HABIT_CATEGORY, 'Work']).deleteHabitCategory(
      UNCATEGORIZED_HABIT_CATEGORY,
    );

    expect(batches).toHaveLength(0);
    const [, payload] = updateDocMock.mock.calls[0] as unknown as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ habitCategories: ['Work'] });
  });

  it('chunks the reassignments into 500-op batches', async () => {
    getDocsDocs.current = Array.from({ length: FIRESTORE_BATCH_LIMIT + 1 }, (_, i) =>
      habit(`h${i}`, 'Health'),
    );
    await make(['Health']).deleteHabitCategory('Health');

    expect(batches).toHaveLength(2);
    expect(batches[0]?.ops).toHaveLength(FIRESTORE_BATCH_LIMIT);
    expect(batches[1]?.ops).toHaveLength(1);
  });

  it('RE-THROWS a failed reassignment instead of resolving, and toasts nothing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDocsDocs.current = [habit('a', 'Health')];
    commitMock.mockRejectedValueOnce(new Error('unavailable'));

    await expect(make(['Health']).deleteHabitCategory('Health')).rejects.toThrow('unavailable');
    // The vocabulary entry survives, so the category is still there to retry.
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is a no-op for a blank name or no household', async () => {
    getDocsDocs.current = [habit('a', 'Health')];
    await make(['Health']).deleteHabitCategory('  ');
    await makeHabitCategoryEditMutations({ db, householdId: null, habitCategories: ['Health'] })
      .deleteHabitCategory('Health');

    expect(batches).toHaveLength(0);
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
