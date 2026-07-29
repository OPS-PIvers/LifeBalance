import { describe, it, expect, vi, afterEach } from 'vitest';
import { format } from 'date-fns';
import { getLocalDateString, isoWeekStartDate } from './dateHelpers';

describe('getLocalDateString', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats a provided date as yyyy-MM-dd in local time', () => {
    expect(getLocalDateString(new Date(2026, 0, 15))).toBe('2026-01-15');
    expect(getLocalDateString(new Date(2026, 11, 5))).toBe('2026-12-05');
  });

  it('zero-pads month and day', () => {
    expect(getLocalDateString(new Date(2026, 2, 3))).toBe('2026-03-03');
  });

  it('defaults to the current date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 7, 10, 30));
    expect(getLocalDateString()).toBe('2026-06-07');
  });

  it('uses the local calendar day, not UTC, late in the evening', () => {
    // 11:30pm local on June 7. In western (negative-offset) timezones this is
    // already June 8 in UTC, which is exactly the bug this helper prevents.
    vi.useFakeTimers();
    const lateEvening = new Date(2026, 5, 7, 23, 30);
    vi.setSystemTime(lateEvening);

    // The day must match the Date's own *local* getDate() (not the UTC day).
    const expected = `2026-06-${String(lateEvening.getDate()).padStart(2, '0')}`;
    expect(getLocalDateString()).toBe(expected);
  });
});

describe('isoWeekStartDate', () => {
  it('resolves an ordinary mid-year week to its Monday', () => {
    // households/{id}/recaps/2026-W27 → Monday 2026-06-29 (matches the server
    // isoWeekId inverse in functions/src/shared/isoWeek.ts).
    const start = isoWeekStartDate('2026-W27');
    expect(start).not.toBeNull();
    expect(format(start as Date, 'yyyy-MM-dd')).toBe('2026-06-29');
  });

  it('resolves a year-boundary week (ISO week-year differs from Jan 1 calendar year)', () => {
    // 2026-W01's Monday falls in the PRIOR calendar year (2025-12-29) — Jan 1
    // 2026 is a Thursday, so ISO week 1 starts the Monday before it.
    const start = isoWeekStartDate('2026-W01');
    expect(start).not.toBeNull();
    expect(format(start as Date, 'yyyy-MM-dd')).toBe('2025-12-29');
  });

  it('resolves a December week whose ISO week-year rolls into the next calendar year', () => {
    const start = isoWeekStartDate('2027-W01');
    expect(start).not.toBeNull();
    expect(format(start as Date, 'yyyy-MM-dd')).toBe('2027-01-04');
  });

  it('returns null for a malformed isoWeek string', () => {
    expect(isoWeekStartDate('not-a-week')).toBeNull();
    expect(isoWeekStartDate('2026-27')).toBeNull();
    expect(isoWeekStartDate('')).toBeNull();
  });

  it('returns null for a well-formed but out-of-range week number', () => {
    // The shape regex alone lets '2026-W60' through — date-fns' setISOWeek
    // then happily extrapolates it into a later ISO week-year instead of
    // failing, so range must be checked explicitly.
    expect(isoWeekStartDate('2026-W00')).toBeNull();
    // 2026 has 53 ISO weeks (getISOWeeksInYear(2026) === 53), so W53 is the
    // last valid week and W54 is already one past it.
    expect(isoWeekStartDate('2026-W54')).toBeNull();
    expect(isoWeekStartDate('2026-W60')).toBeNull();
  });
});
