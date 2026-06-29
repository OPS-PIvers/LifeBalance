import { describe, it, expect } from 'vitest';
import { isYearlyGoalOnTrack } from './yearlyGoal';

const months = (n: number) => Array.from({ length: n }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

describe('isYearlyGoalOnTrack', () => {
  it('is on track when completed months are within 2 of required (the grace window)', () => {
    expect(isYearlyGoalOnTrack({ requiredMonths: 10, successfulMonths: months(8) })).toBe(true); // 8 >= 8
  });

  it('is NOT on track when more than 2 months behind', () => {
    expect(isYearlyGoalOnTrack({ requiredMonths: 10, successfulMonths: months(7) })).toBe(false); // 7 < 8
  });

  it('stays on track once required is met or exceeded', () => {
    expect(isYearlyGoalOnTrack({ requiredMonths: 3, successfulMonths: months(3) })).toBe(true);
    expect(isYearlyGoalOnTrack({ requiredMonths: 3, successfulMonths: months(4) })).toBe(true);
  });

  it('handles a brand-new goal via the grace window', () => {
    expect(isYearlyGoalOnTrack({ requiredMonths: 2, successfulMonths: [] })).toBe(true); // 0 >= 0
    expect(isYearlyGoalOnTrack({ requiredMonths: 3, successfulMonths: [] })).toBe(false); // 0 < 1
  });
});
