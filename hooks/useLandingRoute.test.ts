import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Household, HouseholdMember } from '@/types/schema';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { useLandingRoute } from '@/hooks/useLandingRoute';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: vi.fn(),
}));

vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: vi.fn(() => true),
}));

/**
 * 2F.2 — the wiring test for `resolveLandingRoute`, composed off the live
 * `currentUser.homeScreen` + the same hidden-key set `useModuleVisibility`
 * reads. The pure resolution rules are covered in utils/moduleVisibility.test.ts.
 */
const setup = (
  moduleVisibility?: Household['moduleVisibility'],
  member?: Partial<HouseholdMember> | null,
) => {
  vi.mocked(useHouseholdCore).mockReturnValue({
    householdSettings: { moduleVisibility } as Household,
    currentUser: (member ?? null) as HouseholdMember | null,
  } as unknown as ReturnType<typeof useHouseholdCore>);
};

describe('useLandingRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePowerToolsEnabled).mockReturnValue(true);
  });

  it('an un-customized member lands on Home, exactly as today', () => {
    setup(undefined, {});
    expect(renderHook(() => useLandingRoute()).result.current).toBe('/');
  });

  it('a chosen homeScreen wins while it stays reachable', () => {
    setup(undefined, { homeScreen: 'habits' });
    expect(renderHook(() => useLandingRoute()).result.current).toBe('/habits');
  });

  it('Home hidden for this member routes to the next enabled destination', () => {
    setup(undefined, { hiddenKeys: ['home'] });
    expect(renderHook(() => useLandingRoute()).result.current).toBe('/habits');
  });

  it('a homeScreen naming a household-disabled page falls through to Home', () => {
    setup({ habits: false }, { homeScreen: 'habits' });
    expect(renderHook(() => useLandingRoute()).result.current).toBe('/');
  });

  it('every page hidden lands on Settings', () => {
    setup(undefined, {
      hiddenKeys: [
        'home',
        'track', 'history', 'insights', 'coach', 'rewards', 'challenges',
        'overview', 'transactions', 'trends', 'calendar', 'subscriptions', 'buckets', 'accounts',
        'todos', 'meals', 'shopping',
      ],
    });
    expect(renderHook(() => useLandingRoute()).result.current).toBe('/settings');
  });
});
