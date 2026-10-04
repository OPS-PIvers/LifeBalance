import { describe, expect, it } from 'vitest';
import { wallEventWindow, wallMealPlanWindow } from './wallWindows';

describe('wall listener windows', () => {
  const today = new Date(2026, 9, 3); // Oct 3, 2026 local

  it('covers the previous month through three months out for events', () => {
    expect(wallEventWindow(today)).toEqual({ start: '2026-09-01', end: '2027-01-03' });
  });

  it('covers yesterday through two weeks out for meals', () => {
    expect(wallMealPlanWindow(today)).toEqual({ start: '2026-10-02', end: '2026-10-17' });
  });
});
