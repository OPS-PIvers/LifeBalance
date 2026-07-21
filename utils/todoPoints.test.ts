import { describe, it, expect } from 'vitest';
import { computeTodoCompletionCredit, buildUncompleteCreditReversal, DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
import { HouseholdMember, ToDo } from '@/types/schema';

// Minimal member factory — only the fields computeTodoCompletionCredit reads matter.
const member = (overrides: Partial<HouseholdMember> & { uid: string }): HouseholdMember => ({
  displayName: 'Test',
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const KID: HouseholdMember = member({ uid: 'kid_1', displayName: 'Kiddo', role: 'kid', isManaged: true });
const PARENT: HouseholdMember = member({ uid: 'parent_1', displayName: 'Parent', role: 'admin' });

const todo = (overrides: Partial<Pick<ToDo, 'assignedTo' | 'points'>>): Pick<ToDo, 'assignedTo' | 'points'> => ({
  assignedTo: '',
  ...overrides,
});

describe('computeTodoCompletionCredit', () => {
  it('credits DEFAULT_TODO_POINTS to a managed-kid assignee with no explicit points', () => {
    const result = computeTodoCompletionCredit(todo({ assignedTo: 'kid_1' }), [KID, PARENT]);
    expect(result).toEqual({ memberUid: 'kid_1', points: DEFAULT_TODO_POINTS });
  });

  it('respects a custom todo.points value for a managed-kid assignee', () => {
    const result = computeTodoCompletionCredit(todo({ assignedTo: 'kid_1', points: 12 }), [KID, PARENT]);
    expect(result).toEqual({ memberUid: 'kid_1', points: 12 });
  });

  it('returns null for a non-managed (parent) assignee — dormant for normal households', () => {
    const result = computeTodoCompletionCredit(todo({ assignedTo: 'parent_1', points: 50 }), [KID, PARENT]);
    expect(result).toBeNull();
  });

  it('returns null for an unknown assignee uid', () => {
    const result = computeTodoCompletionCredit(todo({ assignedTo: 'ghost_99' }), [KID, PARENT]);
    expect(result).toBeNull();
  });
});

describe('buildUncompleteCreditReversal', () => {
  // Fixed "today": Wednesday 2026-07-22 → week (weekStartsOn: 1) is Mon 07-20 … Sun 07-26.
  const TODAY = '2026-07-22';

  it('reverses daily + weekly + total for a same-day completion', () => {
    expect(buildUncompleteCreditReversal(5, `${TODAY}T14:30:00`, TODAY)).toEqual({
      'points.total': -5,
      'points.daily': -5,
      'points.weekly': -5,
    });
  });

  it('reverses weekly + total (not daily) for an earlier-this-week completion', () => {
    expect(buildUncompleteCreditReversal(5, '2026-07-20T09:00:00', TODAY)).toEqual({
      'points.total': -5,
      'points.weekly': -5,
    });
  });

  it('reverses only total for a completion from a previous week', () => {
    expect(buildUncompleteCreditReversal(12, '2026-07-15T09:00:00', TODAY)).toEqual({
      'points.total': -12,
    });
  });

  it('reverses only total when the completion has no timestamp (legacy doc)', () => {
    expect(buildUncompleteCreditReversal(5, undefined, TODAY)).toEqual({
      'points.total': -5,
    });
  });

  it('does not reverse weekly for a (clock-skew) future-dated completion beyond today', () => {
    expect(buildUncompleteCreditReversal(5, '2026-07-25T09:00:00', TODAY)).toEqual({
      'points.total': -5,
    });
  });
});
