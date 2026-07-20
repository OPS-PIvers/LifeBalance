import { describe, it, expect } from 'vitest';
import {
  computeNextTodoDueDate,
  buildNextRecurringTodo,
  isTodoFrequency,
} from '@/utils/todoRecurrence';
import type { ToDo } from '@/types/schema';

describe('computeNextTodoDueDate', () => {
  it('advances weekly by 7 days', () => {
    expect(computeNextTodoDueDate('2026-07-14', 'weekly', '2026-07-14')).toBe('2026-07-21');
  });

  it('advances bi-weekly by 14 days', () => {
    expect(computeNextTodoDueDate('2026-07-14', 'bi-weekly', '2026-07-14')).toBe('2026-07-28');
  });

  it('advances monthly by one calendar month', () => {
    expect(computeNextTodoDueDate('2026-07-14', 'monthly', '2026-07-14')).toBe('2026-08-14');
  });

  it('clamps month-end for monthly recurrence', () => {
    // Jan 31 + 1 month -> Feb 28 (date-fns clamp)
    expect(computeNextTodoDueDate('2026-01-31', 'monthly', '2026-01-31')).toBe('2026-02-28');
  });

  it('rolls forward past today when the task was completed late (overdue)', () => {
    // Due Jul 1, completed on Jul 20; next weekly occurrence must be in the future.
    expect(computeNextTodoDueDate('2026-07-01', 'weekly', '2026-07-20')).toBe('2026-07-22');
  });

  it('does not roll forward when the next occurrence is already today', () => {
    expect(computeNextTodoDueDate('2026-07-14', 'weekly', '2026-07-21')).toBe('2026-07-21');
  });
});

describe('isTodoFrequency', () => {
  it('accepts valid frequencies', () => {
    expect(isTodoFrequency('weekly')).toBe(true);
    expect(isTodoFrequency('bi-weekly')).toBe(true);
    expect(isTodoFrequency('monthly')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isTodoFrequency('daily')).toBe(false);
    expect(isTodoFrequency(undefined)).toBe(false);
    expect(isTodoFrequency(null)).toBe(false);
  });
});

const baseTodo: ToDo = {
  id: 'todo-1',
  text: 'Take out trash',
  completeByDate: '2026-07-14',
  assignedTo: 'uid-1',
  isCompleted: false,
  createdBy: 'uid-1',
  createdAt: '2026-07-01T00:00:00.000Z',
};

describe('buildNextRecurringTodo', () => {
  it('returns null for a non-recurring todo', () => {
    expect(buildNextRecurringTodo(baseTodo, '2026-07-14')).toBeNull();
  });

  it('builds the next instance with advanced due date and reset completion', () => {
    const completed: ToDo = {
      ...baseTodo,
      isCompleted: true,
      completedAt: '2026-07-14T12:00:00.000Z',
      recurrence: { frequency: 'weekly' },
    };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect(next).not.toBeNull();
    expect(next!.completeByDate).toBe('2026-07-21');
    expect(next!.isCompleted).toBe(false);
    expect(next!.text).toBe('Take out trash');
    expect(next!.assignedTo).toBe('uid-1');
    // Chain root anchors on the completed instance's id when no root exists yet.
    expect(next!.recurrence).toEqual({ frequency: 'weekly', parentRecurringId: 'todo-1' });
    // Completion fields are not carried forward.
    expect('completedAt' in next!).toBe(false);
  });

  it('preserves an existing chain root across spawns', () => {
    const completed: ToDo = {
      ...baseTodo,
      id: 'todo-5',
      recurrence: { frequency: 'monthly', parentRecurringId: 'root-todo' },
    };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect(next!.recurrence?.parentRecurringId).toBe('root-todo');
  });

  it('carries forward optional fields when present', () => {
    const completed: ToDo = {
      ...baseTodo,
      priority: 'high',
      notes: 'blue bin',
      source: 'manual',
      isImportant: true,
      points: 5,
      recurrence: { frequency: 'weekly' },
    };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect(next!.priority).toBe('high');
    expect(next!.notes).toBe('blue bin');
    expect(next!.source).toBe('manual');
    expect(next!.isImportant).toBe(true);
    expect(next!.points).toBe(5);
  });

  it('carries dueTime and reminder to the next instance, re-armed (F-TODO-14)', () => {
    const completed: ToDo = {
      ...baseTodo,
      dueTime: '18:00',
      reminderMinutesBefore: 30,
      reminderSentAt: '2026-07-14T17:30:00.000Z',
      recurrence: { frequency: 'weekly' },
    };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect(next!.dueTime).toBe('18:00');
    expect(next!.reminderMinutesBefore).toBe(30);
    // The fresh instance's reminder must be re-armed.
    expect('reminderSentAt' in next!).toBe(false);
  });

  it('omits optional fields that are absent', () => {
    const completed: ToDo = { ...baseTodo, recurrence: { frequency: 'weekly' } };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect('priority' in next!).toBe(false);
    expect('notes' in next!).toBe(false);
    expect('isImportant' in next!).toBe(false);
    expect('points' in next!).toBe(false);
  });
});
