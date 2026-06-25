import { describe, it, expect } from 'vitest';
import { computeTodoCompletionCredit, DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
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
