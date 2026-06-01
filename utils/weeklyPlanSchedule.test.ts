import { describe, it, expect } from 'vitest';
import { parseHM, fmtClock, fmtDur, buildSchedule } from './weeklyPlanSchedule';

describe('parseHM', () => {
  it('parses valid 24h times into minutes since midnight', () => {
    expect(parseHM('18:00')).toBe(18 * 60);
    expect(parseHM('00:00')).toBe(0);
    expect(parseHM('9:05')).toBe(9 * 60 + 5);
    expect(parseHM('23:59')).toBe(23 * 60 + 59);
  });

  it('returns null for malformed or out-of-range input', () => {
    expect(parseHM('')).toBeNull();
    expect(parseHM(undefined)).toBeNull();
    expect(parseHM('6pm')).toBeNull();
    expect(parseHM('24:00')).toBeNull();
    expect(parseHM('12:60')).toBeNull();
  });
});

describe('fmtClock', () => {
  it('formats minutes-since-midnight as 12h clock', () => {
    expect(fmtClock(17 * 60 + 40)).toBe('5:40 PM');
    expect(fmtClock(0)).toBe('12:00 AM');
    expect(fmtClock(12 * 60)).toBe('12:00 PM');
    expect(fmtClock(9 * 60 + 5)).toBe('9:05 AM');
  });

  it('wraps negative times into the prior day', () => {
    // 30 minutes before midnight => 11:30 PM
    expect(fmtClock(-30)).toBe('11:30 PM');
  });
});

describe('fmtDur', () => {
  it('formats durations', () => {
    expect(fmtDur(45)).toBe('45m');
    expect(fmtDur(60)).toBe('1h');
    expect(fmtDur(80)).toBe('1h 20m');
    expect(fmtDur(0)).toBe('0m');
  });
});

describe('buildSchedule', () => {
  const meal = {
    defaultServe: '18:00',
    prep: [{ t: 'Chop', min: 10 }, { t: 'Marinate', min: 20, off: true }],
    cook: [{ t: 'Sear', min: 8 }, { t: 'Roast', min: 22 }],
  };

  it('back-calculates the start time from serve minus total', () => {
    const sched = buildSchedule(meal);
    expect(sched.total).toBe(60);
    expect(sched.serve).toBe(18 * 60);
    expect(sched.start).toBe(17 * 60); // 5:00 PM
  });

  it('assigns absolute clock times and phase labels in order', () => {
    const sched = buildSchedule(meal);
    expect(sched.steps.map(s => s.label)).toEqual(['P1', 'P2', '1', '2']);
    expect(sched.steps.map(s => s.phase)).toEqual(['prep', 'prep', 'cook', 'cook']);
    // 5:00, +10 => 5:10, +20 => 5:30, +8 => 5:38
    expect(sched.steps.map(s => fmtClock(s.when))).toEqual([
      '5:00 PM',
      '5:10 PM',
      '5:30 PM',
      '5:38 PM',
    ]);
  });

  it('respects a serve-time override', () => {
    const sched = buildSchedule(meal, '19:30');
    expect(sched.serve).toBe(19 * 60 + 30);
    expect(sched.start).toBe(18 * 60 + 30); // 6:30 PM
  });

  it('falls back to 18:00 when no serve time is available', () => {
    const sched = buildSchedule({ prep: [{ t: 'x', min: 30 }], cook: [] });
    expect(sched.serve).toBe(18 * 60);
    expect(sched.start).toBe(17 * 60 + 30);
  });
});
