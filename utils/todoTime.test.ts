import { describe, it, expect } from 'vitest';
import { isValidDueTime, formatDueTime, compareDueTimes } from './todoTime';
import type { ToDo } from '@/types/schema';

const todo = (overrides: Partial<ToDo>): ToDo => ({
  id: 'id',
  text: 't',
  completeByDate: '2026-07-20',
  assignedTo: 'u',
  isCompleted: false,
  createdBy: 'u',
  createdAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

describe('isValidDueTime', () => {
  it('accepts valid 24h HH:mm', () => {
    expect(isValidDueTime('00:00')).toBe(true);
    expect(isValidDueTime('09:05')).toBe(true);
    expect(isValidDueTime('23:59')).toBe(true);
  });
  it('rejects malformed values', () => {
    expect(isValidDueTime('24:00')).toBe(false);
    expect(isValidDueTime('9:00')).toBe(false);
    expect(isValidDueTime('12:60')).toBe(false);
    expect(isValidDueTime('')).toBe(false);
    expect(isValidDueTime(undefined)).toBe(false);
    expect(isValidDueTime(900)).toBe(false);
  });
});

describe('formatDueTime', () => {
  it('formats morning, afternoon, midnight, noon', () => {
    expect(formatDueTime('09:05')).toBe('9:05 AM');
    expect(formatDueTime('15:00')).toBe('3:00 PM');
    expect(formatDueTime('00:30')).toBe('12:30 AM');
    expect(formatDueTime('12:00')).toBe('12:00 PM');
  });
  it('returns null for absent/malformed input', () => {
    expect(formatDueTime(undefined)).toBeNull();
    expect(formatDueTime('nope')).toBeNull();
  });
});

describe('compareDueTimes', () => {
  it('orders timed todos by time', () => {
    expect(compareDueTimes(todo({ dueTime: '09:00' }), todo({ dueTime: '15:00' }))).toBeLessThan(0);
    expect(compareDueTimes(todo({ dueTime: '15:00' }), todo({ dueTime: '09:00' }))).toBeGreaterThan(0);
  });
  it('sorts timed before untimed', () => {
    expect(compareDueTimes(todo({ dueTime: '18:00' }), todo({}))).toBeLessThan(0);
    expect(compareDueTimes(todo({}), todo({ dueTime: '06:00' }))).toBeGreaterThan(0);
  });
  it('returns 0 when neither has a valid time', () => {
    expect(compareDueTimes(todo({}), todo({}))).toBe(0);
    expect(compareDueTimes(todo({ dueTime: 'bad' }), todo({}))).toBe(0);
  });
});
