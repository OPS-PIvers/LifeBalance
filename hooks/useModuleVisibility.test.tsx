import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Household, HouseholdMember } from '@/types/schema';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { usePageNavigation } from '@/hooks/usePageNavigation';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: vi.fn(),
}));

// The global power-tools flag is read asynchronously in production; pin it here
// so the flag-gate assertions below are deterministic.
vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: vi.fn(() => true),
}));

/**
 * 2F.1 — the wiring test: the household layer (`moduleVisibility`), the member
 * layer (`hiddenKeys`) and the global flag gates, composed off the live core
 * slice. The pure resolution rules are covered in utils/moduleVisibility.test.ts.
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

const setPowerTools = (enabled: boolean) => {
  vi.mocked(usePowerToolsEnabled).mockReturnValue(enabled);
};

describe('useModuleVisibility — member layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPowerTools(true);
  });

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

  // ⚠️ The empty-set case a member reaches by un-hiding all five default Home
  // widgets: the derived page answer must still come from the leaves.
  it('derives Lists from its sub-tabs for a member whose hidden list is empty', () => {
    setup({ todos: false, meals: false, shopping: false }, { hiddenKeys: [] });
    const { result } = renderHook(() => useModuleVisibility());
    expect(result.current.isPlanVisible).toBe(false);
    expect(result.current.isModuleEnabled('lists')).toBe(false);
  });

  // 2F.2 — Home has no household-level toggle, only the member's own choice.
  it('Home is visible by default and goes false once the member hides it', () => {
    setup(undefined, {});
    expect(renderHook(() => useModuleVisibility()).result.current.isHomeVisible).toBe(true);

    setup(undefined, { hiddenKeys: ['home'] });
    expect(renderHook(() => useModuleVisibility()).result.current.isHomeVisible).toBe(false);
  });
});

describe('usePageNavigation — the collapse rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPowerTools(true);
  });

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
});

/**
 * ⚠️ The single-source-of-truth contract. Habits' Coach is gated on the global
 * `powerToolsEnabled` flag; that gate is declared on the nav registry so it lands
 * in the ONE hidden-key set. Before this, the gate was applied only inside the
 * Habits page, so `useModuleVisibility` (what BottomNav and ModuleRoute consult)
 * and the page computed DIFFERENT reachable-leaf sets — the nav offered Habits
 * and the page rendered an empty tab strip with no content.
 */
describe('the power-tools gate is shared by the nav and the page', () => {
  beforeEach(() => vi.clearAllMocks());

  const HABITS_LEAVES_EXCEPT_COACH = ['track', 'history', 'insights', 'rewards', 'challenges'];

  it('drops Coach from the page tree while the flag is off', () => {
    setPowerTools(false);
    setup(undefined, {});
    const { result } = renderHook(() => usePageNavigation('habits'));
    const progress = result.current.groups.find(g => g.key === 'progress');
    expect(progress?.leaves.map(l => l.key)).toEqual(['history', 'insights']);
  });

  it('keeps Coach while the flag is on', () => {
    setPowerTools(true);
    setup(undefined, {});
    const { result } = renderHook(() => usePageNavigation('habits'));
    const progress = result.current.groups.find(g => g.key === 'progress');
    expect(progress?.leaves.map(l => l.key)).toEqual(['history', 'insights', 'coach']);
  });

  it('does NOT offer Habits in the nav when the flag is off and every other leaf is hidden', () => {
    setPowerTools(false);
    setup(undefined, { hiddenKeys: HABITS_LEAVES_EXCEPT_COACH });

    // What BottomNav / ModuleRoute ask…
    const visibility = renderHook(() => useModuleVisibility());
    expect(visibility.result.current.isModuleEnabled('habits')).toBe(false);

    // …and what the page renders off — the SAME empty verdict, so /habits can
    // never render a header with no tabs and no panel.
    const nav = renderHook(() => usePageNavigation('habits'));
    expect(nav.result.current.isVisible).toBe(false);
    expect(nav.result.current.leaves).toEqual([]);
    expect(nav.result.current.soleLeaf).toBeNull();
  });

  it('collapses Habits to Coach alone when the flag is on and every other leaf is hidden', () => {
    setPowerTools(true);
    setup(undefined, { hiddenKeys: HABITS_LEAVES_EXCEPT_COACH });

    const visibility = renderHook(() => useModuleVisibility());
    expect(visibility.result.current.isModuleEnabled('habits')).toBe(true);

    const nav = renderHook(() => usePageNavigation('habits'));
    expect(nav.result.current.soleLeaf?.key).toBe('coach');
  });
});
