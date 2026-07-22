import { describe, it, expect } from 'vitest';
import type { ToDo } from '@/types/schema';
import { sortFlatTodos } from './todoSort';

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
});
