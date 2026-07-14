import { describe, it, expect } from 'vitest';
import { calculateDailyPace, calculateBucketDailyPace } from '@/utils/spendPace';

describe('calculateDailyPace', () => {
  it('returns null when nextPaycheckDate is null', () => {
    expect(
      calculateDailyPace({ safeToSpend: 500, nextPaycheckDate: null }, '2026-07-14')
    ).toBeNull();
  });

  it('returns null when the next paycheck is today', () => {
    expect(
      calculateDailyPace(
        { safeToSpend: 500, nextPaycheckDate: '2026-07-14' },
        '2026-07-14'
      )
    ).toBeNull();
  });

  it('returns null when the next paycheck is in the past', () => {
    expect(
      calculateDailyPace(
        { safeToSpend: 500, nextPaycheckDate: '2026-07-10' },
        '2026-07-14'
      )
    ).toBeNull();
  });

  it('divides safeToSpend by the number of days remaining', () => {
    // 2026-07-14 -> 2026-07-21 is 7 days.
    expect(
      calculateDailyPace(
        { safeToSpend: 700, nextPaycheckDate: '2026-07-21' },
        '2026-07-14'
      )
    ).toBe(100);
  });

  it('floors days-left at 1 to avoid Infinity when paycheck is tomorrow', () => {
    expect(
      calculateDailyPace(
        { safeToSpend: 50, nextPaycheckDate: '2026-07-15' },
        '2026-07-14'
      )
    ).toBe(50);
  });

  it('handles a negative safeToSpend by producing a negative pace', () => {
    expect(
      calculateDailyPace(
        { safeToSpend: -100, nextPaycheckDate: '2026-07-19' },
        '2026-07-14'
      )
    ).toBe(-20);
  });

  it('defaults `today` to the current local date when omitted', () => {
    // Just verify it doesn't throw and returns a number or null.
    const result = calculateDailyPace({ safeToSpend: 100, nextPaycheckDate: '2099-01-01' });
    expect(result).not.toBeNull();
  });
});

describe('calculateBucketDailyPace', () => {
  it('returns null when nextPaycheckDate is null', () => {
    expect(calculateBucketDailyPace(200, { nextPaycheckDate: null }, '2026-07-14')).toBeNull();
  });

  it('returns null when the window has already closed', () => {
    expect(
      calculateBucketDailyPace(200, { nextPaycheckDate: '2026-07-14' }, '2026-07-14')
    ).toBeNull();
  });

  it('divides bucket remaining by days remaining', () => {
    expect(
      calculateBucketDailyPace(140, { nextPaycheckDate: '2026-07-21' }, '2026-07-14')
    ).toBe(20);
  });

  it('supports a negative (over-budget) remaining', () => {
    expect(
      calculateBucketDailyPace(-70, { nextPaycheckDate: '2026-07-21' }, '2026-07-14')
    ).toBe(-10);
  });
});
