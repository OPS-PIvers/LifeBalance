import { describe, it, expect } from 'vitest';
import {
  computeNextTodoDueDate,
  buildNextRecurringTodo,
  computeExpiredTodoRoll,
  isTodoFrequency,
} from '@/utils/todoRecurrence';
import type { Subtask, ToDo } from '@/types/schema';

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
    expect('category' in next!).toBe(false);
    expect('subtasks' in next!).toBe(false);
    expect('resetWhenExpired' in next!).toBe(false);
  });

  // Regression: a respawned weekly chore used to lose its category, dumping it
  // straight into the "N tasks need a category" triage banner every week.
  it('carries the category forward to the next instance', () => {
    const completed: ToDo = {
      ...baseTodo,
      category: 'Home',
      recurrence: { frequency: 'weekly' },
    };
    expect(buildNextRecurringTodo(completed, '2026-07-14')!.category).toBe('Home');
  });

  // Regression: a repeating chore SET lost its whole checklist on completion.
  it('carries subtasks forward with every step reset to not-done', () => {
    const completed: ToDo = {
      ...baseTodo,
      subtasks: [
        { id: 's1', text: 'Counters', isDone: true },
        { id: 's2', text: 'Floor', isDone: false, assigneeId: 'uid-2' },
      ],
      recurrence: { frequency: 'weekly' },
    };
    const next = buildNextRecurringTodo(completed, '2026-07-14');
    expect(next!.subtasks).toEqual([
      { id: 's1', text: 'Counters', isDone: false },
      { id: 's2', text: 'Floor', isDone: false, assigneeId: 'uid-2' },
    ]);
    // The source array must not be mutated.
    expect(completed.subtasks![0]!.isDone).toBe(true);
  });

  it('carries an empty subtasks array through unchanged', () => {
    const completed: ToDo = { ...baseTodo, subtasks: [], recurrence: { frequency: 'weekly' } };
    expect(buildNextRecurringTodo(completed, '2026-07-14')!.subtasks).toEqual([]);
  });

  it('carries the auto-reschedule flag forward', () => {
    const completed: ToDo = {
      ...baseTodo,
      resetWhenExpired: true,
      recurrence: { frequency: 'weekly' },
    };
    expect(buildNextRecurringTodo(completed, '2026-07-14')!.resetWhenExpired).toBe(true);
  });
});

describe('computeExpiredTodoRoll', () => {
  // 2026-07-21 is a Tuesday; 2026-07-24 is the Friday of that same week.
  const weeklyChore: ToDo = {
    ...baseTodo,
    text: 'Kitchen reset',
    completeByDate: '2026-07-21',
    resetWhenExpired: true,
    recurrence: { frequency: 'weekly' },
  };

  it('rolls a weekly Tuesday chore expired mid-week to the NEXT Tuesday', () => {
    expect(computeExpiredTodoRoll(weeklyChore, '2026-07-24')).toEqual({
      completeByDate: '2026-07-28',
    });
  });

  it('rolls a chore expired by several periods to the first FUTURE occurrence', () => {
    const stale: ToDo = { ...weeklyChore, completeByDate: '2026-06-30' };
    // 06-30 is a Tuesday; the first Tuesday after 07-24 is 07-28.
    expect(computeExpiredTodoRoll(stale, '2026-07-24')).toEqual({
      completeByDate: '2026-07-28',
    });
  });

  it('honours bi-weekly and monthly cadences', () => {
    expect(
      computeExpiredTodoRoll({ ...weeklyChore, recurrence: { frequency: 'bi-weekly' } }, '2026-07-24'),
    ).toEqual({ completeByDate: '2026-08-04' });
    expect(
      computeExpiredTodoRoll({ ...weeklyChore, recurrence: { frequency: 'monthly' } }, '2026-07-24'),
    ).toEqual({ completeByDate: '2026-08-21' });
  });

  it('returns null when the due date is today', () => {
    expect(computeExpiredTodoRoll(weeklyChore, '2026-07-21')).toBeNull();
  });

  it('returns null when the due date is in the future', () => {
    expect(computeExpiredTodoRoll(weeklyChore, '2026-07-20')).toBeNull();
  });

  it('returns null when the flag is off or absent', () => {
    expect(computeExpiredTodoRoll({ ...weeklyChore, resetWhenExpired: false }, '2026-07-24')).toBeNull();
    const { resetWhenExpired: _omitted, ...withoutFlag } = weeklyChore;
    expect(computeExpiredTodoRoll(withoutFlag, '2026-07-24')).toBeNull();
  });

  it('returns null for a non-recurring to-do', () => {
    const { recurrence: _omitted, ...oneOff } = weeklyChore;
    expect(computeExpiredTodoRoll(oneOff, '2026-07-24')).toBeNull();
  });

  it('returns null for a completed to-do', () => {
    expect(computeExpiredTodoRoll({ ...weeklyChore, isCompleted: true }, '2026-07-24')).toBeNull();
  });

  it('returns null for a held-for-review capture', () => {
    expect(computeExpiredTodoRoll({ ...weeklyChore, needsReview: true }, '2026-07-24')).toBeNull();
  });

  it('returns null for a malformed stored due date rather than writing garbage', () => {
    expect(computeExpiredTodoRoll({ ...weeklyChore, completeByDate: 'not-a-date' }, '2026-07-24')).toBeNull();
    expect(computeExpiredTodoRoll({ ...weeklyChore, completeByDate: '' }, '2026-07-24')).toBeNull();
  });

  it('clears every checked step when the chore rolls forward', () => {
    const subtasks: Subtask[] = [
      { id: 's1', text: 'Counters', isDone: true },
      { id: 's2', text: 'Floor', isDone: false },
    ];
    const roll = computeExpiredTodoRoll({ ...weeklyChore, subtasks }, '2026-07-24');
    expect(roll).toEqual({
      completeByDate: '2026-07-28',
      subtasks: [
        { id: 's1', text: 'Counters', isDone: false },
        { id: 's2', text: 'Floor', isDone: false },
      ],
    });
    expect(subtasks[0]!.isDone).toBe(true); // source untouched
  });

  it('omits the subtasks key when the checklist is already clean', () => {
    const roll = computeExpiredTodoRoll(
      { ...weeklyChore, subtasks: [{ id: 's1', text: 'Counters', isDone: false }] },
      '2026-07-24',
    );
    expect(roll).not.toBeNull();
    expect('subtasks' in roll!).toBe(false);
  });

  it('omits the subtasks key when there are no subtasks at all', () => {
    const roll = computeExpiredTodoRoll(weeklyChore, '2026-07-24');
    expect('subtasks' in roll!).toBe(false);
  });
});
