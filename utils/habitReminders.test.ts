import { describe, it, expect } from 'vitest';
import type { HabitReminderConfig, NotificationPreferences } from '@/types/schema';
import {
  defaultHabitReminder,
  formatReminderDays,
  formatReminderSummary,
  formatReminderTime,
  getHabitReminder,
  hasEnabledHabitReminder,
  isValidReminderTime,
  normalizeHabitReminder,
} from './habitReminders';

const config = (overrides: Partial<HabitReminderConfig> = {}): HabitReminderConfig => ({
  enabled: true,
  time: '08:00',
  days: [1, 2, 3, 4, 5],
  ...overrides,
});

describe('isValidReminderTime', () => {
  it('accepts every well-formed 24-hour time', () => {
    for (const time of ['00:00', '09:05', '13:30', '23:59']) {
      expect(isValidReminderTime(time)).toBe(true);
    }
  });

  it('rejects out-of-range, unpadded, and non-time values', () => {
    for (const time of ['24:00', '12:60', '8:00', '0800', '', 'noon', '08:0']) {
      expect(isValidReminderTime(time)).toBe(false);
    }
  });
});

describe('defaultHabitReminder', () => {
  it('gives a daily habit every day', () => {
    expect(defaultHabitReminder('daily').days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('gives a weekly habit one day, so it cannot nag seven times per completion', () => {
    expect(defaultHabitReminder('weekly').days).toEqual([1]);
  });

  it('starts enabled at the default time', () => {
    expect(defaultHabitReminder('daily')).toMatchObject({ enabled: true, time: '08:00' });
  });
});

describe('normalizeHabitReminder', () => {
  it('returns null for values that are not configs at all', () => {
    for (const raw of [null, undefined, 'x', 42, []]) {
      expect(normalizeHabitReminder(raw)).toBeNull();
    }
  });

  it('returns null when the time is unusable, since there is no safe guess', () => {
    expect(normalizeHabitReminder({ enabled: true, time: '25:00', days: [1] })).toBeNull();
    expect(normalizeHabitReminder({ enabled: true, days: [1] })).toBeNull();
  });

  it('drops out-of-range and duplicate days rather than rejecting the config', () => {
    const result = normalizeHabitReminder({
      enabled: true,
      time: '07:30',
      days: [7, -1, 3, 3, 1, 'x', null, 2.5],
    });
    expect(result).toEqual({ enabled: true, time: '07:30', days: [1, 3] });
  });

  it('treats a missing days array as no days', () => {
    expect(normalizeHabitReminder({ enabled: true, time: '07:30' })?.days).toEqual([]);
  });

  it('only counts an explicit enabled:true as enabled', () => {
    expect(normalizeHabitReminder({ time: '07:30', days: [1] })?.enabled).toBe(false);
    expect(normalizeHabitReminder({ enabled: 'yes', time: '07:30', days: [1] })?.enabled).toBe(false);
  });
});

describe('getHabitReminder', () => {
  it('reads and normalizes one habit off the member preferences', () => {
    const prefs = {
      perHabitReminders: { h1: { enabled: true, time: '06:15', days: [3, 1] } },
    } as unknown as NotificationPreferences;
    expect(getHabitReminder(prefs, 'h1')).toEqual({ enabled: true, time: '06:15', days: [1, 3] });
  });

  it('returns null for an absent habit, absent map, or absent prefs', () => {
    expect(getHabitReminder(undefined, 'h1')).toBeNull();
    expect(getHabitReminder({} as NotificationPreferences, 'h1')).toBeNull();
    expect(
      getHabitReminder({ perHabitReminders: {} } as NotificationPreferences, 'h1')
    ).toBeNull();
  });
});

describe('formatReminderTime', () => {
  it('renders 12-hour time with a meridiem', () => {
    expect(formatReminderTime('00:00')).toBe('12:00 AM');
    expect(formatReminderTime('08:05')).toBe('8:05 AM');
    expect(formatReminderTime('12:00')).toBe('12:00 PM');
    expect(formatReminderTime('13:30')).toBe('1:30 PM');
    expect(formatReminderTime('23:59')).toBe('11:59 PM');
  });

  it('passes an unparseable value through untouched', () => {
    expect(formatReminderTime('nope')).toBe('nope');
  });
});

describe('formatReminderDays', () => {
  it('names the recognizable sets', () => {
    expect(formatReminderDays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(formatReminderDays([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(formatReminderDays([0, 6])).toBe('Weekends');
  });

  it('lists anything else in week order', () => {
    expect(formatReminderDays([5, 1, 3])).toBe('Mon, Wed, Fri');
  });

  it('says so when no day is selected', () => {
    expect(formatReminderDays([])).toBe('No days');
  });
});

describe('formatReminderSummary', () => {
  it('joins time and days', () => {
    expect(formatReminderSummary(config({ time: '18:00' }))).toBe('6:00 PM · Weekdays');
  });
});

describe('hasEnabledHabitReminder', () => {
  it('is false without prefs or without any reminder', () => {
    expect(hasEnabledHabitReminder(undefined)).toBe(false);
    expect(hasEnabledHabitReminder({} as NotificationPreferences)).toBe(false);
  });

  it('is true when at least one reminder is enabled with a day', () => {
    const prefs = { perHabitReminders: { h1: config() } } as unknown as NotificationPreferences;
    expect(hasEnabledHabitReminder(prefs)).toBe(true);
  });

  it('ignores a disabled reminder', () => {
    const prefs = {
      perHabitReminders: { h1: config({ enabled: false }) },
    } as unknown as NotificationPreferences;
    expect(hasEnabledHabitReminder(prefs)).toBe(false);
  });

  it('ignores a reminder with no days, which could never fire', () => {
    const prefs = {
      perHabitReminders: { h1: config({ days: [] }) },
    } as unknown as NotificationPreferences;
    expect(hasEnabledHabitReminder(prefs)).toBe(false);
  });

  it('ignores a corrupt entry but still sees a good one beside it', () => {
    const prefs = {
      perHabitReminders: { bad: { enabled: true, time: '99:99', days: [1] }, good: config() },
    } as unknown as NotificationPreferences;
    expect(hasEnabledHabitReminder(prefs)).toBe(true);
  });
});
