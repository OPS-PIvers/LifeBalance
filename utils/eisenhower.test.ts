import { describe, it, expect } from 'vitest';
import { isUrgent, quadrantForTodo, QUADRANT_ORDER } from './eisenhower';
import { ToDo } from '@/types/schema';

// Fixed local "today" for deterministic boundaries (a Wednesday).
const TODAY = new Date(2026, 6, 8); // 2026-07-08 local midnight

const makeTodo = (overrides: Partial<ToDo>): ToDo => ({
  id: 't1',
  text: 'Test task',
  completeByDate: '2026-07-08',
  assignedTo: 'u1',
  isCompleted: false,
  createdBy: 'u1',
  createdAt: '2026-07-01T10:00:00.000Z',
  ...overrides,
});

describe('isUrgent', () => {
  // Must match the list view's "Immediate" section: overdue, today, or tomorrow.
  it('overdue (yesterday) is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-07' }), TODAY)).toBe(true);
  });
  it('due today is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-08' }), TODAY)).toBe(true);
  });
  it('due tomorrow is urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-09' }), TODAY)).toBe(true);
  });
  it('due day after tomorrow is NOT urgent', () => {
    expect(isUrgent(makeTodo({ completeByDate: '2026-07-10' }), TODAY)).toBe(false);
  });
});

describe('quadrantForTodo', () => {
  it('urgent + important → do', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08', isImportant: true }), TODAY)).toBe('do');
  });
  it('not urgent + important → schedule', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-20', isImportant: true }), TODAY)).toBe('schedule');
  });
  it('urgent + not important → delegate', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08', isImportant: false }), TODAY)).toBe('delegate');
  });
  it('not urgent + not important → later', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-20' }), TODAY)).toBe('later');
  });
  it('missing isImportant is treated as not important', () => {
    expect(quadrantForTodo(makeTodo({ completeByDate: '2026-07-08' }), TODAY)).toBe('delegate');
  });
});

describe('QUADRANT_ORDER', () => {
  it('renders do, schedule, delegate, later in that order', () => {
    expect(QUADRANT_ORDER).toEqual(['do', 'schedule', 'delegate', 'later']);
  });
});
