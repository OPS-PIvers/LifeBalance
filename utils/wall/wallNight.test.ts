import { describe, expect, it } from 'vitest';
import { isNight, minutesInZone, parseHhmm } from './wallNight';

const CHI = 'America/Chicago';
// 2026-10-03 is CDT (UTC-5).
const at = (hhmm: string) => new Date(`2026-10-03T${hhmm}:00-05:00`);

describe('parseHhmm', () => {
  it('parses valid times and rejects malformed ones', () => {
    expect(parseHhmm('00:00')).toBe(0);
    expect(parseHhmm('22:30')).toBe(1350);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('7:00')).toBeNull();
    expect(parseHhmm('')).toBeNull();
  });
});

describe('minutesInZone', () => {
  it('reads the wall clock in the given zone, not the host zone', () => {
    expect(minutesInZone(at('00:05'), CHI)).toBe(5);
    expect(minutesInZone(at('15:15'), CHI)).toBe(915);
    expect(minutesInZone(at('15:15'), 'UTC')).toBe(20 * 60 + 15);
  });
});

describe('isNight', () => {
  const night = { start: '22:00', end: '06:00' };

  it.each([
    ['21:59', false],
    ['22:00', true],
    ['23:59', true],
    ['00:00', true],
    ['05:59', true],
    ['06:00', false],
    ['15:15', false],
  ])('crossing midnight: %s → %s', (time, expected) => {
    expect(isNight(at(time), night, CHI)).toBe(expected);
  });

  it('handles a same-day window', () => {
    const nap = { start: '13:00', end: '15:00' };
    expect(isNight(at('12:59'), nap, CHI)).toBe(false);
    expect(isNight(at('13:00'), nap, CHI)).toBe(true);
    expect(isNight(at('15:00'), nap, CHI)).toBe(false);
  });

  it('treats equal or malformed bounds as no night', () => {
    expect(isNight(at('23:00'), { start: '22:00', end: '22:00' }, CHI)).toBe(false);
    expect(isNight(at('23:00'), { start: 'late', end: '06:00' }, CHI)).toBe(false);
  });
});
