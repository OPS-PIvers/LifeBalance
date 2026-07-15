import { describe, it, expect } from 'vitest';
import { getAiUsageDisplay } from '@/utils/aiUsageDisplay';
import { LEGACY_AI_DAILY_QUOTA, PREMIUM_LIMITS, FREE_LIMITS } from '@/utils/entitlements';
import type { Household } from '@/types/schema';

const TODAY = '2026-07-14';

const baseHousehold = (overrides: Partial<Household> = {}): Household =>
  ({
    id: 'h1',
    ...overrides,
  }) as unknown as Household;

describe('getAiUsageDisplay', () => {
  it('returns null when household is missing', () => {
    expect(getAiUsageDisplay(null, false, TODAY)).toBeNull();
    expect(getAiUsageDisplay(undefined, false, TODAY)).toBeNull();
  });

  it('returns null when aiUsage is absent (no calls made yet)', () => {
    expect(getAiUsageDisplay(baseHousehold(), false, TODAY)).toBeNull();
  });

  it('returns null when lastResetDate is not today (stale prior-day count)', () => {
    const household = baseHousehold({
      aiUsage: { dailyCount: 3, lastResetDate: '2026-07-13' },
    });
    expect(getAiUsageDisplay(household, false, TODAY)).toBeNull();
  });

  it('uses the flat legacy quota when billing is off', () => {
    const household = baseHousehold({
      aiUsage: { dailyCount: 2, lastResetDate: TODAY },
    });
    expect(getAiUsageDisplay(household, false, TODAY)).toEqual({
      used: 2,
      cap: LEGACY_AI_DAILY_QUOTA,
    });
  });

  it('uses the plan-aware cap when billing is on (free plan)', () => {
    const household = baseHousehold({
      aiUsage: { dailyCount: 2, lastResetDate: TODAY },
    });
    expect(getAiUsageDisplay(household, true, TODAY)).toEqual({
      used: 2,
      cap: FREE_LIMITS.aiDailyCap,
    });
  });

  it('uses the premium cap when billing is on and subscription is active', () => {
    const household = baseHousehold({
      aiUsage: { dailyCount: 5, lastResetDate: TODAY },
      subscription: { plan: 'premium', status: 'active' } as Household['subscription'],
    });
    expect(getAiUsageDisplay(household, true, TODAY)).toEqual({
      used: 5,
      cap: PREMIUM_LIMITS.aiDailyCap,
    });
  });

  it('does not hide when used is 0 for a fresh reset today', () => {
    const household = baseHousehold({
      aiUsage: { dailyCount: 0, lastResetDate: TODAY },
    });
    expect(getAiUsageDisplay(household, false, TODAY)).toEqual({
      used: 0,
      cap: LEGACY_AI_DAILY_QUOTA,
    });
  });
});
