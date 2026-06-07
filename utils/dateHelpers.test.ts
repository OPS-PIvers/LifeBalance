import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLocalDateString } from './dateHelpers';

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

    const expected = `2026-06-0${lateEvening.getDate()}`;
    expect(getLocalDateString()).toBe(expected);
    // The local-day digit must match the Date's own local getDate().
    expect(getLocalDateString()).toBe(
      `2026-06-${String(lateEvening.getDate()).padStart(2, '0')}`
    );
  });
});
