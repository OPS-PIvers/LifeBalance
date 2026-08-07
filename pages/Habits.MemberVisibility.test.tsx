import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Habits from './Habits';
import type { Habit, Household, HouseholdMember } from '@/types/schema';

/**
 * 2F.1 — the per-member visibility layer as the Habits PAGE sees it.
 *
 * The scenario that matters: the global `powerToolsEnabled` flag is off (so Coach
 * is unreachable) and the member has hidden every other Habits view. The nav must
 * not offer Habits at all — and if it somehow does, the page must degrade to a
 * redirect (render nothing) rather than a header with an empty tab strip and no
 * content. The flag gate lives on the shared nav registry precisely so those two
 * answers cannot diverge; this test is the page-side half of that contract
 * (hooks/useModuleVisibility.test.tsx covers the nav-side half).
 */

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ key: 'default', pathname: '/habits', state: null }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/habits/HabitCard', () => ({
  default: ({ habit }: { habit: Habit }) => <div data-testid="habit-card">{habit.title}</div>,
}));

vi.mock('@/components/modals/HabitCreatorWizard', () => ({
  default: () => <div data-testid="habit-wizard" />,
}));

// The page now owns the shared habit form (create + edit) as a sibling of the
// wizard, so it mounts on every render. Stubbed like the wizard above — these
// suites assert on the habit list, not on the form.
vi.mock('@/components/modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />,
}));

const powerToolsEnabled = { current: true };
vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: () => powerToolsEnabled.current,
}));

const habit = (id: string, title: string): Habit =>
  ({
    id,
    title,
    category: 'Fitness',
    type: 'positive',
    period: 'daily',
    count: 0,
    targetCount: 1,
    streakDays: 0,
    totalCount: 0,
    completedDates: [],
    lastUpdated: '2026-07-24T10:00:00.000Z',
    scoringType: 'threshold',
    basePoints: 10,
  }) as Habit;

const core = {
  habits: [habit('h1', 'Morning run')],
  members: [] as HouseholdMember[],
  householdSettings: { moduleVisibility: undefined } as Household,
  currentUser: null as HouseholdMember | null,
};

const mockUseHousehold = vi.fn(() => core);

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

/** The five Habits leaves other than the power-tools-gated Coach. */
const EVERY_LEAF_EXCEPT_COACH = ['track', 'history', 'insights', 'rewards', 'challenges'];

const setMember = (hiddenKeys?: string[]) => {
  core.currentUser = (hiddenKeys ? { uid: 'user-1', hiddenKeys } : null) as HouseholdMember | null;
};

describe('Habits page — member visibility (2F.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    powerToolsEnabled.current = true;
    setMember(undefined);
  });

  it('renders the full three-tab strip for an un-customized member', () => {
    const { container } = render(<Habits />);
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole('tab', { name: 'Track' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rewards' })).toBeInTheDocument();
  });

  it('drops the tab strip entirely once one view is left (collapse rule)', () => {
    setMember(['history', 'insights', 'coach', 'rewards', 'challenges']);
    render(<Habits />);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByTestId('habit-card')).toBeInTheDocument();
  });

  it('collapses to Coach alone when it is the only leaf left and power tools are ON', () => {
    setMember(EVERY_LEAF_EXCEPT_COACH);
    render(<Habits />);
    // Still a real page, not an empty frame.
    expect(screen.getByRole('heading', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  // ⚠️ THE regression: power tools off makes Coach unreachable too, so there is
  // no leaf left. Rendering on would give a header, an empty tab strip and no
  // panel — the blank dead end. `ModuleRoute` is already redirecting by now, so
  // the page renders nothing at all.
  it('renders NOTHING when power tools are off and every other leaf is hidden', () => {
    powerToolsEnabled.current = false;
    setMember(EVERY_LEAF_EXCEPT_COACH);
    const { container } = render(<Habits />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: 'Habits' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByTestId('habit-card')).not.toBeInTheDocument();
  });

  it('a household-off Habits module renders nothing either', () => {
    core.householdSettings = { moduleVisibility: { habits: false } } as Household;
    try {
      const { container } = render(<Habits />);
      expect(container).toBeEmptyDOMElement();
    } finally {
      core.householdSettings = { moduleVisibility: undefined } as Household;
    }
  });
});
