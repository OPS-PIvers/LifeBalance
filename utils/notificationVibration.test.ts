import { describe, it, expect } from 'vitest';
import { getVibratePattern, DEFAULT_VIBRATE_PATTERN } from '@/utils/notificationVibration';

describe('getVibratePattern', () => {
  it('returns a distinct pattern for streak_warning', () => {
    expect(getVibratePattern('streak_warning')).toEqual([200, 80, 200, 80, 200]);
  });

  it('returns a distinct pattern for bill_reminder', () => {
    expect(getVibratePattern('bill_reminder')).toEqual([150, 60, 150]);
  });

  it('returns a distinct pattern for habit_reminder', () => {
    expect(getVibratePattern('habit_reminder')).toEqual([80, 60, 80]);
  });

  it('gives streak_warning and habit_reminder different patterns', () => {
    expect(getVibratePattern('streak_warning')).not.toEqual(getVibratePattern('habit_reminder'));
  });

  it('falls back to the default pattern for an unknown type', () => {
    expect(getVibratePattern('some_future_type')).toEqual(DEFAULT_VIBRATE_PATTERN);
  });

  it('falls back to the default pattern for undefined/null/empty', () => {
    expect(getVibratePattern(undefined)).toEqual(DEFAULT_VIBRATE_PATTERN);
    expect(getVibratePattern(null)).toEqual(DEFAULT_VIBRATE_PATTERN);
    expect(getVibratePattern('')).toEqual(DEFAULT_VIBRATE_PATTERN);
  });

  it('covers every known push notification type without throwing', () => {
    const types = [
      'habit_reminder',
      'action_queue_reminder',
      'streak_warning',
      'bill_reminder',
      'budget_alert',
      'weekly_recap',
      'monthly_money_recap',
      'test_notification',
    ];
    for (const type of types) {
      expect(getVibratePattern(type).length).toBeGreaterThan(0);
    }
  });
});
