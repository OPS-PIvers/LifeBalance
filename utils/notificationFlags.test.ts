import { describe, it, expect } from 'vitest';
import { computeAnyNotificationsEnabled } from './notificationFlags';
import type { NotificationPreferences } from '@/types/schema';

const basePrefs: NotificationPreferences = {
  habitReminders: { enabled: false, time: '08:00' },
  actionQueueReminders: { enabled: false, time: '08:00' },
  budgetAlerts: { enabled: false },
  streakWarnings: { enabled: false, time: '20:00' },
  billReminders: { enabled: false, daysBeforeDue: 3, time: '09:00' },
  weeklyRecap: { enabled: false },
};

describe('computeAnyNotificationsEnabled', () => {
  it('is false with no tokens, regardless of prefs', () => {
    expect(computeAnyNotificationsEnabled({ ...basePrefs, habitReminders: { enabled: true, time: '08:00' } }, [])).toBe(false);
    expect(computeAnyNotificationsEnabled({ ...basePrefs, habitReminders: { enabled: true, time: '08:00' } }, undefined)).toBe(false);
  });

  it('is true with tokens but no prefs at all (weeklyRecap defaults to enabled)', () => {
    expect(computeAnyNotificationsEnabled(undefined, ['token1'])).toBe(true);
  });

  it('is false when tokens exist but every category is disabled (weeklyRecap explicitly off)', () => {
    expect(computeAnyNotificationsEnabled(basePrefs, ['token1'])).toBe(false);
  });

  it('is true when habitReminders is enabled and a token exists', () => {
    const prefs = { ...basePrefs, habitReminders: { enabled: true, time: '08:00' } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('is true when actionQueueReminders is enabled and a token exists', () => {
    const prefs = { ...basePrefs, actionQueueReminders: { enabled: true, time: '08:00' } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('is true when streakWarnings is enabled and a token exists', () => {
    const prefs = { ...basePrefs, streakWarnings: { enabled: true, time: '20:00' } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('is true when billReminders is enabled and a token exists', () => {
    const prefs = { ...basePrefs, billReminders: { enabled: true, daysBeforeDue: 3, time: '09:00' } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('budgetAlerts alone does not count (not one of the four scan categories)', () => {
    const prefs = { ...basePrefs, budgetAlerts: { enabled: true } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(false);
  });

  it('treats weeklyRecap as enabled by default when absent, even if every other category is off', () => {
    const { weeklyRecap: _omit, ...rest } = basePrefs;
    expect(computeAnyNotificationsEnabled(rest, ['token1'])).toBe(true);
  });

  it('treats weeklyRecap as enabled when present without an explicit enabled field set to false', () => {
    const prefs = { ...basePrefs, weeklyRecap: { enabled: true } };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('is false when weeklyRecap is explicitly disabled and every other category is off', () => {
    expect(computeAnyNotificationsEnabled({ ...basePrefs, weeklyRecap: { enabled: false } }, ['token1'])).toBe(false);
  });

  it('is true when digestMode is enabled even if every per-type category and weeklyRecap are off', () => {
    const prefs = {
      ...basePrefs,
      weeklyRecap: { enabled: false },
      digestMode: { enabled: true, time: '07:00' },
    };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(true);
  });

  it('digestMode alone with enabled: false does not count', () => {
    const prefs = {
      ...basePrefs,
      weeklyRecap: { enabled: false },
      digestMode: { enabled: false, time: '07:00' },
    };
    expect(computeAnyNotificationsEnabled(prefs, ['token1'])).toBe(false);
  });
});
