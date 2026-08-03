import { describe, it, expect } from 'vitest';
import type { Household } from '@/types/schema';
import {
  getPlan,
  isPremium,
  getLimits,
  kidProfileLimitReached,
  resolveIsPremiumHousehold,
  FREE_LIMITS,
  PREMIUM_LIMITS,
} from './entitlements';

/** Build the minimal household shape the entitlement helpers read. */
const hh = (subscription?: Household['subscription']): Pick<Household, 'subscription'> => ({
  subscription,
});

describe('getPlan', () => {
  it('treats an absent subscription block as the free plan (legacy households)', () => {
    expect(getPlan(hh(undefined))).toBe('free');
  });

  it('returns premium for an active premium subscription', () => {
    expect(getPlan(hh({ plan: 'premium', status: 'active' }))).toBe('premium');
  });

  it('returns premium during a trial', () => {
    expect(getPlan(hh({ plan: 'premium', status: 'trialing' }))).toBe('premium');
  });

  it('keeps premium while past_due (grace period, not yet downgraded)', () => {
    expect(getPlan(hh({ plan: 'premium', status: 'past_due' }))).toBe('premium');
  });

  it('falls back to free when a premium plan is canceled, even if the plan field is stale', () => {
    expect(getPlan(hh({ plan: 'premium', status: 'canceled' }))).toBe('free');
  });

  it('returns free for an incomplete subscription that never activated', () => {
    expect(getPlan(hh({ plan: 'premium', status: 'incomplete' }))).toBe('free');
  });

  it('returns free when the stored plan is free', () => {
    expect(getPlan(hh({ plan: 'free', status: 'active' }))).toBe('free');
  });
});

describe('isPremium', () => {
  it('is true only when getPlan resolves to premium', () => {
    expect(isPremium(hh({ plan: 'premium', status: 'active' }))).toBe(true);
    expect(isPremium(hh({ plan: 'premium', status: 'canceled' }))).toBe(false);
    expect(isPremium(hh(undefined))).toBe(false);
  });
});

describe('resolveIsPremiumHousehold', () => {
  // Mirrors functions/src/recap/index.ts's isPremiumHousehold — the server
  // condition a stored recap's `premium` field is generated from, so a
  // client-derived recap (ARCH-1, utils/recapCompose.ts) has to agree with
  // it exactly rather than approximate it via isPremium()/getPlan().
  it('is true for every household while billing is off, regardless of subscription', () => {
    expect(resolveIsPremiumHousehold(hh(undefined), false)).toBe(true);
    expect(resolveIsPremiumHousehold(hh({ plan: 'free', status: 'active' }), false)).toBe(true);
    expect(resolveIsPremiumHousehold(hh({ plan: 'premium', status: 'canceled' }), false)).toBe(true);
  });

  it('once billing is live, is true only for a status that still grants access', () => {
    expect(resolveIsPremiumHousehold(hh({ plan: 'premium', status: 'active' }), true)).toBe(true);
    expect(resolveIsPremiumHousehold(hh({ plan: 'premium', status: 'trialing' }), true)).toBe(true);
    expect(resolveIsPremiumHousehold(hh({ plan: 'premium', status: 'past_due' }), true)).toBe(true);
    expect(resolveIsPremiumHousehold(hh({ plan: 'premium', status: 'canceled' }), true)).toBe(false);
    expect(resolveIsPremiumHousehold(hh(undefined), true)).toBe(false);
  });

  it('with billing live, ignores the `plan` field the way the server does — status alone decides', () => {
    // isPremium()/getPlan() ALSO require plan === 'premium'; the server's
    // isPremiumHousehold does not. A status-active row with a stale/absent
    // `plan` field must still resolve premium here, matching the server.
    expect(resolveIsPremiumHousehold(hh({ plan: 'free', status: 'active' }), true)).toBe(true);
    // Sanity check that this genuinely diverges from isPremium() for that input.
    expect(isPremium(hh({ plan: 'free', status: 'active' }))).toBe(false);
  });
});

describe('getLimits', () => {
  it('returns the free limit table for a free household', () => {
    expect(getLimits(hh(undefined))).toEqual(FREE_LIMITS);
  });

  it('returns the premium limit table for an active premium household', () => {
    expect(getLimits(hh({ plan: 'premium', status: 'active' }))).toEqual(PREMIUM_LIMITS);
  });
});

describe('limit tables', () => {
  it('grant premium strictly more headroom than free', () => {
    expect(PREMIUM_LIMITS.maxMembers).toBeGreaterThan(FREE_LIMITS.maxMembers);
    expect(PREMIUM_LIMITS.aiDailyCap).toBeGreaterThan(FREE_LIMITS.aiDailyCap);
    expect(FREE_LIMITS.recapEnabled).toBe(false);
    expect(PREMIUM_LIMITS.recapEnabled).toBe(true);
  });

  it('keeps the free AI cap a small teaser value', () => {
    // The free cap is a deliberately tight teaser to drive upgrades. It only applies
    // once billing is live; geminiService falls back to the legacy 100/day cap while
    // billing is off, so current users are unaffected (tested in geminiService.test).
    expect(FREE_LIMITS.aiDailyCap).toBe(3);
  });

  it('caps managed kid profiles with premium granting strictly more (Plan 080)', () => {
    expect(FREE_LIMITS.maxKidProfiles).toBe(2);
    expect(PREMIUM_LIMITS.maxKidProfiles).toBe(10);
    expect(PREMIUM_LIMITS.maxKidProfiles).toBeGreaterThan(FREE_LIMITS.maxKidProfiles);
  });
});

describe('kidProfileLimitReached', () => {
  it('is false while under the free cap', () => {
    expect(kidProfileLimitReached(hh(undefined), 0)).toBe(false);
    expect(kidProfileLimitReached(hh(undefined), FREE_LIMITS.maxKidProfiles - 1)).toBe(false);
  });

  it('is true exactly at the free cap (uses >=, so the next add is blocked)', () => {
    expect(kidProfileLimitReached(hh(undefined), FREE_LIMITS.maxKidProfiles)).toBe(true);
  });

  it('is true over the free cap', () => {
    expect(kidProfileLimitReached(hh(undefined), FREE_LIMITS.maxKidProfiles + 5)).toBe(true);
  });

  it('uses the premium cap for an active premium household', () => {
    const premium = hh({ plan: 'premium', status: 'active' });
    // Above the free cap but under premium → still allowed.
    expect(kidProfileLimitReached(premium, FREE_LIMITS.maxKidProfiles)).toBe(false);
    expect(kidProfileLimitReached(premium, PREMIUM_LIMITS.maxKidProfiles - 1)).toBe(false);
    expect(kidProfileLimitReached(premium, PREMIUM_LIMITS.maxKidProfiles)).toBe(true);
  });
});
