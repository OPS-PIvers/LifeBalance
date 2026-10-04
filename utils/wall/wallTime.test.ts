import { describe, expect, it } from 'vitest';
import { clockText, hourLabel, wallTimeText, zonedDateString, zonedParts } from './wallTime';

describe('zonedParts', () => {
  it('reads date parts in the household zone', () => {
    const d = new Date('2026-10-03T20:15:00Z'); // 3:15 pm CDT
    expect(zonedParts(d, 'America/Chicago')).toEqual({
      year: 2026, month: 10, day: 3, hour: 15, minute: 15, weekday: 'Saturday', monthName: 'October',
    });
    expect(zonedDateString(new Date('2026-10-04T03:00:00Z'), 'America/Chicago')).toBe('2026-10-03');
  });
});

describe('time text', () => {
  it('clock never shows am/pm', () => {
    expect(clockText(15, 5)).toBe('3:05');
    expect(clockText(0, 0)).toBe('12:00');
    expect(clockText(12, 30)).toBe('12:30');
  });

  it.each([
    [6, 30, '6:30 am'],
    [7, 0, '7:00'],
    [15, 30, '3:30'],
    [20, 59, '8:59'],
    [21, 0, '9:00 pm'],
    [0, 15, '12:15 am'],
  ])('event time %i:%i → %s', (h, m, text) => {
    expect(wallTimeText(h, m)).toBe(text);
  });

  it('labels hours', () => {
    expect(hourLabel(18)).toBe('6 pm');
    expect(hourLabel(0)).toBe('12 am');
    expect(hourLabel(11)).toBe('11 am');
  });
});
