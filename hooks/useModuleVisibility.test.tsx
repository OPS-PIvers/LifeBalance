import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Household, HouseholdMember } from '@/types/schema';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { usePageNavigation } from '@/hooks/usePageNavigation';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: vi.fn(),
}));

/**
 * 2F.1 — the wiring test: the household layer (`moduleVisibility`) and the
 * member layer (`hiddenKeys`) composed off the live core slice. The pure
 * resolution rules are covered in utils/moduleVisibility2F1.test.ts.
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

describe('useModuleVisibility — member layer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('an un-customized member sees every page (pages fail OPEN)', () => {
    setup(undefined, {});
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isModuleEnabled('money')).toBe(true);
    expect(result.current.isModuleEnabled('habits')).toBe(true);
    expect(result.current.isPlanVisible).toBe(true);
    expect(result.current.isPlanTabVisible('todos')).toBe(true);
  });

  it('a member with only the legacy dashboardHidden still sees every page', () => {
    // The pre-2F.1 widget list is read as the hidden set; it holds only widget
    // ids, so no nav leaf is affected.
    setup(undefined, { dashboardHidden: ['insight', 'activityFeed'] });
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isModuleEnabled('money')).toBe(true);
    expect(result.current.isPlanVisible).toBe(true);
  });

  it('hiding every Money leaf takes Money out of this member’s nav', () => {
    setup(undefined, {
      hiddenKeys: [
        'overview',
        'transactions',
        'trends',
        'calendar',
        'subscriptions',
        'buckets',
        'accounts',
      ],
    });
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isModuleEnabled('money')).toBe(false);
    // …without touching anything else.
    expect(result.current.isModuleEnabled('habits')).toBe(true);
  });

  it('hiding to-dos stops the Action Queue from surfacing to-do cards', () => {
    // useActionQueue gates its to-do items on isPlanTabVisible('todos').
    setup(undefined, { hiddenKeys: ['todos'] });
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isPlanTabVisible('todos')).toBe(false);
    expect(result.current.isPlanTabVisible('meals')).toBe(true);
    // Lists itself survives — meals/shopping are still reachable.
    expect(result.current.isPlanVisible).toBe(true);
  });

  it('the household layer still wins: a household-off module stays off', () => {
    setup({ habits: false }, { hiddenKeys: [] });
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isModuleEnabled('habits')).toBe(false);
  });

  it("reads the household's legacy 'plan' key as 'lists'", () => {
    setup({ plan: false }, {});
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isPlanVisible).toBe(false);
    expect(result.current.isModuleEnabled('lists')).toBe(false);
  });
});

describe('usePageNavigation — the collapse rule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports no sole leaf while several views remain', () => {
    setup(undefined, {});
    const { result } = renderHook(() => usePageNavigation('money'));
    expect(result.current.groups).toHaveLength(4);
    expect(result.current.soleLeaf).toBeNull();
  });

  it('collapses a group to a direct link once one leaf is left', () => {
    setup(undefined, { hiddenKeys: ['trends'] });
    const { result } = renderHook(() => usePageNavigation('money'));
    const activity = result.current.groups.find(g => g.key === 'activity');
    expect(activity?.leaves).toHaveLength(1);
  });

  it('collapses the whole page when exactly one view is left', () => {
    setup(undefined, {
      hiddenKeys: ['overview', 'transactions', 'trends', 'subscriptions', 'buckets', 'accounts'],
    });
    const { result } = renderHook(() => usePageNavigation('money'));
    expect(result.current.soleLeaf?.key).toBe('calendar');
  });

  it('honours extraHidden (Habits’ power-tools-gated Coach)', () => {
    setup(undefined, {});
    const { result } = renderHook(() => usePageNavigation('habits', ['coach']));
    const progress = result.current.groups.find(g => g.key === 'progress');
    expect(progress?.leaves.map(l => l.key)).toEqual(['history', 'insights']);
  });
});
