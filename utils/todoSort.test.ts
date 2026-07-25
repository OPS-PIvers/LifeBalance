import { describe, it, expect } from 'vitest';
import type { ToDo } from '@/types/schema';
import {
  sortFlatTodos,
  groupTodosByCategory,
  TODO_SORT_MODES,
  TODO_SORT_LABELS,
} from './todoSort';

const makeTodo = (overrides: Partial<ToDo> & { id: string }): ToDo => ({
  text: overrides.id,
  completeByDate: '2026-07-21',
  assignedTo: 'user1',
  isCompleted: false,
  createdBy: 'user1',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const ids = (todos: ToDo[]) => todos.map(t => t.id);

describe('sortFlatTodos', () => {
  it('puts starred tasks before unstarred ones', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'plain', completeByDate: '2026-07-01' }),
      makeTodo({ id: 'starred', completeByDate: '2026-07-30', isImportant: true }),
    ]);
    expect(ids(sorted)).toEqual(['starred', 'plain']);
  });

  it('orders each group overdue first, then ascending due date', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'future', completeByDate: '2026-08-01' }),
      makeTodo({ id: 'overdue', completeByDate: '2026-07-01' }),
      makeTodo({ id: 'today', completeByDate: '2026-07-21' }),
      makeTodo({ id: 's-future', completeByDate: '2026-08-01', isImportant: true }),
      makeTodo({ id: 's-overdue', completeByDate: '2026-07-01', isImportant: true }),
    ]);
    expect(ids(sorted)).toEqual(['s-overdue', 's-future', 'overdue', 'today', 'future']);
  });

  it('sorts undated tasks last within their group', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'undated', completeByDate: '' }),
      makeTodo({ id: 'dated', completeByDate: '2026-08-01' }),
      makeTodo({ id: 's-undated', completeByDate: '', isImportant: true }),
      makeTodo({ id: 's-dated', completeByDate: '2026-08-01', isImportant: true }),
    ]);
    expect(ids(sorted)).toEqual(['s-dated', 's-undated', 'dated', 'undated']);
  });

  it('orders timed tasks before untimed ones on the same day, by time', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'untimed' }),
      makeTodo({ id: 'late', dueTime: '15:00' }),
      makeTodo({ id: 'early', dueTime: '09:00' }),
    ]);
    expect(ids(sorted)).toEqual(['early', 'late', 'untimed']);
  });

  it('is stable within ties (keeps existing order) and does not mutate its input', () => {
    const input = [
      makeTodo({ id: 'a' }),
      makeTodo({ id: 'b' }),
      makeTodo({ id: 'c' }),
    ];
    const snapshot = [...input];
    const sorted = sortFlatTodos(input);
    expect(ids(sorted)).toEqual(['a', 'b', 'c']);
    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
  });

  it('explicit false isImportant sorts with the unstarred group', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'false-star', completeByDate: '2026-07-01', isImportant: false }),
      makeTodo({ id: 'starred', completeByDate: '2026-08-01', isImportant: true }),
    ]);
    expect(ids(sorted)).toEqual(['starred', 'false-star']);
  });

  // --- F-TODO-15: 'category' mode ---

  it("'category' orders by category name A→Z, case-insensitively", () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'work', category: 'Work' }),
      makeTodo({ id: 'errands', category: 'errands' }),
      makeTodo({ id: 'home', category: 'Home' }),
    ], 'category');
    expect(ids(sorted)).toEqual(['errands', 'home', 'work']);
  });

  it("'category' pins uncategorized last even when it would sort first alphabetically", () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'none' }), // no category at all
      makeTodo({ id: 'zebra', category: 'Zebra' }),
      makeTodo({ id: 'apples', category: 'Apples' }),
    ], 'category');
    expect(ids(sorted)).toEqual(['apples', 'zebra', 'none']);
  });

  it("'category' treats a whitespace-only category as uncategorized", () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'blank', category: '   ' }),
      makeTodo({ id: 'empty', category: '' }),
      makeTodo({ id: 'zebra', category: 'Zebra' }),
    ], 'category');
    expect(ids(sorted)).toEqual(['zebra', 'blank', 'empty']);
  });

  it("'category' falls through to the due-date comparator within one category", () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'later', category: 'Home', completeByDate: '2026-08-01' }),
      makeTodo({ id: 'undated', category: 'Home', completeByDate: '' }),
      makeTodo({ id: 'sooner', category: 'Home', completeByDate: '2026-07-01' }),
      makeTodo({ id: 'other', category: 'Errands', completeByDate: '2026-09-01' }),
    ], 'category');
    expect(ids(sorted)).toEqual(['other', 'sooner', 'later', 'undated']);
  });

  it("'category' ignores the star flag (stars only group in 'important' mode)", () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'starred-work', category: 'Work', isImportant: true }),
      makeTodo({ id: 'plain-home', category: 'Home' }),
    ], 'category');
    expect(ids(sorted)).toEqual(['plain-home', 'starred-work']);
  });

  it('leaves the existing modes unchanged when categories are present', () => {
    const input = [
      makeTodo({ id: 'plain', completeByDate: '2026-07-01', category: 'Zebra' }),
      makeTodo({ id: 'starred', completeByDate: '2026-07-30', isImportant: true }),
    ];
    expect(ids(sortFlatTodos(input))).toEqual(['starred', 'plain']);
    expect(ids(sortFlatTodos(input, 'due'))).toEqual(['plain', 'starred']);
    expect(ids(sortFlatTodos(input, 'added'))).toEqual(['plain', 'starred']);
  });
});

describe('TODO_SORT_MODES / TODO_SORT_LABELS', () => {
  it("appends 'category' last so the menu order stays important/due/added/category", () => {
    expect(TODO_SORT_MODES).toEqual(['important', 'due', 'added', 'category']);
  });

  it('labels every mode', () => {
    for (const mode of TODO_SORT_MODES) {
      expect(TODO_SORT_LABELS[mode]).toBeTruthy();
    }
    expect(TODO_SORT_LABELS.category).toBe('Category');
  });
});

describe('groupTodosByCategory', () => {
  it('emits one section per category, uncategorized last', () => {
    const sorted = sortFlatTodos([
      makeTodo({ id: 'none' }),
      makeTodo({ id: 'zebra', category: 'Zebra' }),
      makeTodo({ id: 'apples', category: 'Apples' }),
    ], 'category');
    const groups = groupTodosByCategory(sorted);
    expect(groups.map(g => g.category)).toEqual(['Apples', 'Zebra', null]);
    expect(groups.map(g => ids(g.todos))).toEqual([['apples'], ['zebra'], ['none']]);
  });

  it('preserves the incoming order inside each section', () => {
    const groups = groupTodosByCategory([
      makeTodo({ id: 'h1', category: 'Home' }),
      makeTodo({ id: 'h2', category: 'Home' }),
      makeTodo({ id: 'h3', category: 'Home' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(ids(groups[0]?.todos ?? [])).toEqual(['h1', 'h2', 'h3']);
  });

  it('collapses case variants into one section labelled by the first spelling seen', () => {
    const groups = groupTodosByCategory([
      makeTodo({ id: 'a', category: 'Home' }),
      makeTodo({ id: 'b', category: 'home' }),
      makeTodo({ id: 'c', category: 'HOME' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.category).toBe('Home');
    expect(ids(groups[0]?.todos ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('folds absent, empty, and whitespace-only categories into the single null section', () => {
    const groups = groupTodosByCategory([
      makeTodo({ id: 'absent' }),
      makeTodo({ id: 'empty', category: '' }),
      makeTodo({ id: 'blank', category: '  ' }),
      makeTodo({ id: 'home', category: 'Home' }),
    ]);
    expect(groups.map(g => g.category)).toEqual(['Home', null]);
    expect(ids(groups[1]?.todos ?? [])).toEqual(['absent', 'empty', 'blank']);
  });

  it('returns an empty array for no to-dos and does not mutate its input', () => {
    const input = [makeTodo({ id: 'a', category: 'Home' })];
    const snapshot = [...input];
    expect(groupTodosByCategory([])).toEqual([]);
    groupTodosByCategory(input);
    expect(input).toEqual(snapshot);
  });
});
