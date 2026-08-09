import React from 'react';
import { fireEvent, render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HabitCard from './HabitCard';
import { Habit, HabitSubmission, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { buildHabitRowMemberContext } from '@/utils/habitRowAttribution';
import { habitPeriodStart, pointsForHabitOnDate } from '@/utils/habitLogic';
// Only `subDays` is faked below (for the freeze badge's "yesterday") — `format`
// /`parseISO`/`subWeeks` pass through to the real implementation, so weekly
// streak math (calculateWeeklyStreak walks ISO weeks via `subWeeks`, never
// `subDays`) stays correct in these tests.
import { format, parseISO, subWeeks } from 'date-fns';

// Mock context
const { mockHouseholdContext } = vi.hoisted(() => ({
  mockHouseholdContext: {
    toggleHabit: vi.fn(),
    deleteHabit: vi.fn(),
    archiveHabit: vi.fn(),
    unarchiveHabit: vi.fn(),
    resetHabit: vi.fn(),
    creditHabitCompletion: vi.fn(() => Promise.resolve()),
    uncreditHabitCompletion: vi.fn(() => Promise.resolve()),
    creditHouseholdCompletion: vi.fn(() => Promise.resolve()),
    uncreditHouseholdCompletion: vi.fn(() => Promise.resolve()),
    // Household-undo dual-path guard: the handler checks for a submission doc
    // before falling back to the attribution-only primitive (mirrors
    // DayHabitEditor). Default to "no doc found" so every pre-existing test
    // exercises the attribution-only fallback unchanged.
    getHabitSubmissions: vi.fn((): Promise<HabitSubmission[]> => Promise.resolve([])),
    deleteHabitSubmission: vi.fn(() => Promise.resolve()),
    activeChallenge: null as unknown,
  }
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // HabitCard reads useGamification; alias every hook to the same value object.
  const value = () => mockHouseholdContext;
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

// Mock child modals
vi.mock('@/components/modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />
}));

vi.mock('@/components/modals/HabitSubmissionLogModal', () => ({
  default: () => <div data-testid="habit-submission-log-modal" />
}));

// Mock Drawer
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title: string }) => isOpen ? (
    <div data-testid="mobile-drawer">
      <h1>{title}</h1>
      {children}
    </div>
  ) : null
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  GripVertical: () => <span data-testid="icon-grip" />,
  X: () => <span data-testid="icon-x" />,
  Flame: () => <span data-testid="icon-flame" />,
  MoreVertical: () => <span data-testid="icon-more-vertical" />,
  Edit2: () => <span data-testid="icon-edit" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Target: () => <span data-testid="icon-target" />,
  Calendar: () => <span data-testid="icon-calendar" />,
  Snowflake: () => <span data-testid="icon-snowflake" />,
  MessageSquarePlus: () => <span data-testid="icon-message-square-plus" />,
  Archive: () => <span data-testid="icon-archive" />,
  ArchiveRestore: () => <span data-testid="icon-archive-restore" />,
  // Household credit mode: HouseholdAvatar's house glyph (picker row + badge).
  Home: () => <span data-testid="icon-home" />,
  Users: () => <span data-testid="icon-users" />,
  Check: () => <span data-testid="icon-check" />,
}));

// Mock date-fns with controlled dates. `mockedYesterday.current` is mutable so
// tests can simulate the local day rolling over while a card stays mounted.
// Local-time strings (no trailing Z) keep the derived yyyy-MM-dd stable in any TZ.
const { mockedYesterday } = vi.hoisted(() => ({
  mockedYesterday: { current: new Date('2024-02-09T12:00:00') },
}));

vi.mock('date-fns', async () => {
  const actual = await vi.importActual<typeof import('date-fns')>('date-fns');
  return {
    ...actual,
    subDays: (_date: Date | number, _days: number) => mockedYesterday.current,
  };
});

const mockHabit: Habit = {
  id: 'h1',
  title: 'Test Habit',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  targetCount: 1,
  count: 0,
  streakDays: 0,
  basePoints: 10,
  completedDates: [],
  lastUpdated: '2023-01-01',
  scoringType: 'threshold',
  totalCount: 0
};

const setupMatchMedia = (isDesktop: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: query === '(min-width: 640px)' ? isDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('HabitCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true); // Default to Desktop
  });

  it('renders dropdown menu on desktop', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Options for Test Habit'));

    // Check for dropdown content (using role="menu")
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Verify Drawer is NOT present
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument();
  });

  it('renders drawer menu on mobile', async () => {
    setupMatchMedia(false); // Mock Mobile

    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Options for Test Habit'));

    // Check for Drawer content
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();

    // Verify Dropdown is NOT present
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('HabitCard - core row interactions (ListRow migration regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('tapping the full-row overlay increments the habit', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    await user.click(screen.getByLabelText(`Toggle habit: ${mockHabit.title}, current count: ${mockHabit.count}`));

    expect(mockHouseholdContext.toggleHabit).toHaveBeenCalledWith(mockHabit.id, 'up');
    expect(mockHouseholdContext.resetHabit).not.toHaveBeenCalled();
  });

  it('tapping the X resets the habit without also toggling it', async () => {
    const user = userEvent.setup();
    // lastUpdated must be current: a stale habit renders unselected (no X).
    render(<HabitCard habit={{ ...mockHabit, count: 1, lastUpdated: new Date().toISOString() }} />);

    await user.click(screen.getByLabelText('Reset habit progress'));

    expect(mockHouseholdContext.resetHabit).toHaveBeenCalledWith(mockHabit.id);
    expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();
  });

  it('the X is not rendered while the habit count is zero', () => {
    render(<HabitCard habit={mockHabit} />);
    expect(screen.queryByLabelText('Reset habit progress')).not.toBeInTheDocument();
  });

  it('opening the options menu does not toggle the habit', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    await user.click(screen.getByLabelText('Options for Test Habit'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();
  });

  it('renders a grip that forwards pointer-down when onGripPointerDown is set, and none otherwise', () => {
    const onGripPointerDown = vi.fn();
    const { container, rerender } = render(
      <HabitCard habit={mockHabit} onGripPointerDown={onGripPointerDown} />
    );

    const grip = container.querySelector('.cursor-grab') as HTMLElement;
    expect(grip).not.toBeNull();
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onGripPointerDown).toHaveBeenCalledTimes(1);
    expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();

    rerender(<HabitCard habit={{ ...mockHabit, lastUpdated: '2023-01-02' }} />);
    expect(container.querySelector('.cursor-grab')).toBeNull();
  });
});

describe('HabitCard - auto-applied freeze protection (Plan 25)', () => {
  const yesterdayStr = '2024-02-09';

  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true); // Desktop for easier testing
    mockedYesterday.current = new Date('2024-02-09T12:00:00');
  });

  const baseHabit: Habit = {
    id: 'h1',
    title: 'Test Habit',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: ['2024-02-07', '2024-02-08'],
    streakDays: 2,
    lastUpdated: '2024-02-10T00:00:00Z',
  };

  it('shows the Protected badge when yesterday is frozen', () => {
    render(<HabitCard habit={{ ...baseHabit, frozenDates: [yesterdayStr] }} />);

    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByTestId('icon-snowflake')).toBeInTheDocument();
  });

  it('does NOT show the Protected badge without a frozen yesterday', () => {
    render(<HabitCard habit={baseHabit} />);
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('does NOT show the Protected badge for an older frozen date', () => {
    render(<HabitCard habit={{ ...baseHabit, frozenDates: ['2024-02-05'] }} />);
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('tracks the current "yesterday" after a midnight rollover, not the mount-time one', () => {
    const frozen = { ...baseHabit, frozenDates: [yesterdayStr] };
    const { rerender } = render(<HabitCard habit={frozen} />);
    expect(screen.getByText('Protected')).toBeInTheDocument();

    // The local day rolls over while the card stays mounted; a Firestore-driven
    // habit update (changed lastUpdated) re-renders the same instance. The badge
    // must follow the NEW yesterday (2024-02-10, not frozen) and disappear.
    mockedYesterday.current = new Date('2024-02-10T12:00:00');
    rerender(<HabitCard habit={{ ...frozen, lastUpdated: '2024-02-11T00:00:00Z' }} />);

    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('the manual "Repair Streak" affordance is gone from the menu', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Options for Test Habit'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });
});

describe('HabitCard - period-aware multiplier display', () => {
  // basePoints is 10 everywhere below, so the points badge text directly
  // encodes the applied multiplier: "10 pts" = 1.0x, "15 pts" = 1.5x, "20 pts" = 2.0x.
  const baseWeekly: Habit = {
    id: 'h1',
    title: 'Weekly Habit',
    category: 'Health',
    type: 'positive',
    period: 'weekly',
    targetCount: 1,
    count: 0,
    streakDays: 0,
    basePoints: 10,
    completedDates: [],
    lastUpdated: '2024-02-10T00:00:00Z',
    scoringType: 'threshold',
    totalCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('weekly habit with a 2-week streak shows the 1.5x multiplier (15 pts), not 1.0x', () => {
    render(<HabitCard habit={{ ...baseWeekly, streakDays: 2 }} />);

    // 1.5x of 10 base points = 15. The hardcoded daily ladder would show 10 (1.0x).
    expect(screen.getByText('15 pts')).toBeInTheDocument();
    expect(screen.queryByText('10 pts')).not.toBeInTheDocument();
  });

  // Per-member points (stage 2): the streak PILL is gone from the row — streak
  // now reads as its own small chip paired with the credited member's avatar,
  // and the exact number also lives in the habit's log. The MULTIPLIER it
  // earns must still be visible, which is what these assertions pin.
  it('no longer renders a streak pill, at any cadence', () => {
    const { rerender } = render(<HabitCard habit={{ ...baseWeekly, streakDays: 2 }} />);
    expect(screen.queryByText(/2 Weeks?/)).not.toBeInTheDocument();

    rerender(<HabitCard habit={{ ...baseWeekly, period: 'daily', streakDays: 5, lastUpdated: '2024-02-10T00:01:00Z' }} />);
    expect(screen.queryByText(/5 Days?/)).not.toBeInTheDocument();
  });

  it('weekly habit with a 4-week streak shows the 2.0x multiplier (20 pts)', () => {
    render(<HabitCard habit={{ ...baseWeekly, streakDays: 4 }} />);

    expect(screen.getByText('20 pts')).toBeInTheDocument();
    expect(screen.queryByText(/4 Weeks?/)).not.toBeInTheDocument();
  });

  it('weekly habit with a 1-week streak nudges "1 week from 1.5x" (week unit, not day)', () => {
    render(<HabitCard habit={{ ...baseWeekly, streakDays: 1 }} />);

    expect(screen.getByText('1 week from 1.5x!')).toBeInTheDocument();
    // The old daily-only ladder would never nudge at streakDays === 1, and would
    // use the "day" unit; make sure neither leaks through.
    expect(screen.queryByText(/from 2x/)).not.toBeInTheDocument();
    expect(screen.queryByText(/1 day from/)).not.toBeInTheDocument();
  });

  it('weekly habit with a 3-week streak nudges "1 week from 2x"', () => {
    render(<HabitCard habit={{ ...baseWeekly, streakDays: 3 }} />);

    expect(screen.getByText('1 week from 2x!')).toBeInTheDocument();
  });

  it('regression: daily habit with a 3-day streak still shows 1.5x (15 pts)', () => {
    const dailyHabit: Habit = {
      ...baseWeekly,
      title: 'Daily Habit',
      period: 'daily',
      streakDays: 3,
    };
    render(<HabitCard habit={dailyHabit} />);

    expect(screen.getByText('15 pts')).toBeInTheDocument();
    // Daily nudge ladder unchanged: no nudge fires at a 3-day streak.
    expect(screen.queryByText(/from 1.5x/)).not.toBeInTheDocument();
    expect(screen.queryByText(/from 2x/)).not.toBeInTheDocument();
  });

  it('regression: daily habit with a 2-day streak still nudges "1 day from 1.5x"', () => {
    const dailyHabit: Habit = {
      ...baseWeekly,
      title: 'Daily Habit',
      period: 'daily',
      streakDays: 2,
    };
    render(<HabitCard habit={dailyHabit} />);

    expect(screen.getByText('1 day from 1.5x!')).toBeInTheDocument();
  });
});

describe('HabitCard - React.memo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('skips re-render when irrelevant habit fields change but memoized fields are stable', () => {
    const habit: Habit = {
      id: 'h1',
      title: 'Memo Habit',
      category: 'Health',
      type: 'positive',
      period: 'daily',
      targetCount: 1,
      count: 1,
      streakDays: 3,
      basePoints: 10,
      completedDates: ['2024-02-09'],
      lastUpdated: '2024-02-10T00:00:00Z',
      scoringType: 'threshold',
      totalCount: 1,
    };

    const { rerender } = render(<HabitCard habit={habit} />);

    // Verify initial render shows the habit title
    expect(screen.getByText('Memo Habit')).toBeInTheDocument();

    // Re-render with a habit object where only a field NOT in the comparator changes
    // (totalCount is not compared, but id/count/streakDays/lastUpdated are stable)
    const updatedHabit: Habit = { ...habit, totalCount: 999 };
    rerender(<HabitCard habit={updatedHabit} />);

    // Component should still display correctly (memo preserved the DOM)
    expect(screen.getByText('Memo Habit')).toBeInTheDocument();
  });
});

// --- Per-member attribution (stage 2) ---------------------------------------
// "Today" is read from the same helper the component uses, so these fixtures
// carry no weekday dependency of their own.
const TODAY = getLocalDateString();
const PAUL = 'paul-uid';
const JEN = 'jen-uid';

const ROSTER_MEMBERS: HouseholdMember[] = [
  { uid: PAUL, displayName: 'Paul', role: 'admin', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: JEN, displayName: 'Jen', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
  {
    uid: 'kid_leo', displayName: 'Leo', role: 'kid', isManaged: true,
    points: { daily: 0, weekly: 0, total: 0 },
  },
];
const ROSTER = buildHabitRowMemberContext(ROSTER_MEMBERS, PAUL);

const attributedHabit = (completedBy: Record<string, number>, overrides: Partial<Habit> = {}): Habit => ({
  ...mockHabit,
  title: 'Morning walk',
  scoringType: 'incremental',
  count: Object.values(completedBy).reduce((a, b) => a + b, 0),
  totalCount: 1,
  completedDates: [TODAY],
  completedBy: { [TODAY]: completedBy },
  lastUpdated: new Date().toISOString(),
  ...overrides,
});

const pieSlices = (container: HTMLElement): SVGPathElement[] =>
  Array.from(container.querySelectorAll<SVGPathElement>('svg[viewBox="0 0 46 46"] path'));

describe('HabitCard - per-member freeze protection (freezeMode: per_member, stage 6)', () => {
  const yesterdayStr = '2024-02-09';

  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
    mockedYesterday.current = new Date('2024-02-09T12:00:00');
  });

  const frozenForPaulOnly: Habit = {
    id: 'h1',
    title: 'Test Habit',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: ['2024-02-07', '2024-02-08'],
    streakDays: 2,
    lastUpdated: '2024-02-10T00:00:00Z',
    // A per-member freeze token was spent for Paul only — the household-wide
    // `frozenDates` (shared/freeze_both) is deliberately left untouched, which
    // is exactly what a real `freezeMode: 'per_member'` write looks like.
    frozenDatesBy: { [yesterdayStr]: [PAUL] },
  };

  it('shows the Protected badge for the member whose chain the per-member freeze bridged', () => {
    const attribution = buildHabitRowMemberContext(ROSTER_MEMBERS, PAUL);
    render(<HabitCard habit={frozenForPaulOnly} attribution={attribution} />);

    expect(screen.getByText('Protected')).toBeInTheDocument();
  });

  it('does NOT show the Protected badge for a different member whose chain was never bridged', () => {
    const attribution = buildHabitRowMemberContext(ROSTER_MEMBERS, JEN);
    render(<HabitCard habit={frozenForPaulOnly} attribution={attribution} />);

    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });

  it('does NOT show the Protected badge with no attribution context at all', () => {
    render(<HabitCard habit={frozenForPaulOnly} />);
    expect(screen.queryByText('Protected')).not.toBeInTheDocument();
  });
});

describe('HabitCard - pie attribution counter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('fills the toggle with one solid disc for a solo completion', () => {
    const { container } = render(
      <HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />
    );

    const slices = pieSlices(container);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.getAttribute('fill')).toBe('#285742'); // accent-600
    expect(screen.getByLabelText('Toggle habit: Morning walk, current count: 1')).toBeInTheDocument();
  });

  it('splits the disc 2:1 in member colors, first adult from 12 o’clock', () => {
    const { container } = render(
      <HabitCard habit={attributedHabit({ [PAUL]: 2, [JEN]: 1 })} attribution={ROSTER} />
    );

    const slices = pieSlices(container);
    expect(slices.map(p => p.getAttribute('fill'))).toEqual(['#285742', '#b87a29']);
    // No stroke between slices — the seam was explicitly rejected.
    expect(slices.every(p => !p.getAttribute('stroke'))).toBe(true);
  });

  it('leaves a grandfathered (unattributed) completion looking exactly as before', () => {
    const { container } = render(
      <HabitCard
        habit={{ ...mockHabit, count: 1, totalCount: 1, completedDates: [TODAY], lastUpdated: new Date().toISOString() }}
        attribution={ROSTER}
      />
    );

    expect(pieSlices(container)).toHaveLength(0);
    expect(screen.queryByText(/completed this/)).not.toBeInTheDocument();
  });

  it('renders no attribution at all without the roster context (non-Habits surfaces)', () => {
    const { container } = render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} />);
    expect(pieSlices(container)).toHaveLength(0);
  });

  it('shows nothing for a stale row, whose counter belongs to a previous period', () => {
    // A fixed past timestamp, not clock arithmetic: `Date.now() - 86_400_000`
    // near local midnight in a UTC+X zone can still land on TODAY's local date,
    // at which point the habit isn't stale and this assertion flips (the
    // getLocalDateString rule in CLAUDE.md, same family of bug).
    const { container } = render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { lastUpdated: '2024-02-09T12:00:00.000Z' })}
        attribution={ROSTER}
      />
    );
    expect(pieSlices(container)).toHaveLength(0);
  });
});

describe('HabitCard - per-member streak chips', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('names each credited member for screen readers', () => {
    render(<HabitCard habit={attributedHabit({ [PAUL]: 2, [JEN]: 1 })} attribution={ROSTER} />);

    expect(screen.getByText('Paul completed this 2 times')).toBeInTheDocument();
    expect(screen.getByText('Jen completed this')).toBeInTheDocument();
  });

  // Tiers and their screen-reader text are covered in
  // HabitDoneByAvatars.test.tsx — this suite mocks date-fns (for the freeze
  // badge's "yesterday"), which would also blunt a DAILY streak walk here
  // (calculateStreak's `subDays` calls resolve to the frozen mock date). A
  // WEEKLY habit's streak walks `subWeeks` instead, which is untouched by the
  // mock (see the `date-fns` import above) — the tests below use that to get
  // a real, chip-worthy streak inside this suite.

  it('shows no avatars on an untouched row', () => {
    render(<HabitCard habit={mockHabit} attribution={ROSTER} />);
    expect(screen.queryByText(/completed this/)).not.toBeInTheDocument();
  });

  // A streak chip is a celebration; a "streak" on a negative habit is a run of
  // the behaviour the household is trying to stop. The streak pill this
  // replaced was gated on `isPositive`, and that gate has to survive.
  it('credits the member on a NEGATIVE habit but never chips them', () => {
    const { container } = render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { type: 'negative', basePoints: -10, streakDays: 30 })}
        attribution={ROSTER}
      />
    );

    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.queryAllByTestId('icon-flame')).toHaveLength(0);
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
    // The pie still reads: who did it is the point, on a negative habit most of all.
    expect(pieSlices(container)).toHaveLength(1);
  });

  // Belt-and-suspenders on the test above: `attributedHabit` only records ONE
  // day of completion (streakDays:30 is inert for entry.streak, which is
  // derived from the member's ACTUAL completedBy history, not that field), so
  // that test's streak never crosses the ember threshold and would pass even
  // without the showStreakChips gate. This one forces a REAL, chip-worthy
  // streak (three consecutive ISO weeks, via subWeeks — unaffected by this
  // suite's subDays mock) so the suppression is actually exercised.
  it('suppresses the streak chip AND the streak text for a negative habit at a chip-worthy streak, but keeps the avatar (F1)', () => {
    // Three consecutive completed ISO weeks — real weekly-streak math (see the
    // comment above), landing squarely in the "ember" tier a positive habit
    // would chip.
    const weekStart = habitPeriodStart('weekly', TODAY);
    const oneWeekAgo = format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd');
    const twoWeeksAgo = format(subWeeks(parseISO(weekStart), 2), 'yyyy-MM-dd');

    const negativeHabit: Habit = {
      ...mockHabit,
      title: 'Late night snack',
      type: 'negative',
      period: 'weekly',
      scoringType: 'incremental',
      basePoints: -10,
      count: 1,
      totalCount: 3,
      streakDays: 3,
      completedDates: [TODAY, oneWeekAgo, twoWeeksAgo],
      completedBy: {
        [TODAY]: { [PAUL]: 1 },
        [oneWeekAgo]: { [PAUL]: 1 },
        [twoWeeksAgo]: { [PAUL]: 1 },
      },
      lastUpdated: new Date().toISOString(),
    };

    render(<HabitCard habit={negativeHabit} attribution={ROSTER} />);

    // The avatar still renders — who did it is the point on a negative habit
    // most of all — but neither the chip NOR the streak text celebrates three
    // consecutive weeks of a habit the household is trying to discourage.
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.queryByText(/week streak/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('icon-flame')).toHaveLength(0);
  });

  it('still chips a POSITIVE habit at the same streak (regression guard for the negative-habit suppression above)', () => {
    const weekStart = habitPeriodStart('weekly', TODAY);
    const oneWeekAgo = format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd');
    const twoWeeksAgo = format(subWeeks(parseISO(weekStart), 2), 'yyyy-MM-dd');

    const positiveHabit: Habit = {
      ...mockHabit,
      title: 'Weekly walk',
      type: 'positive',
      period: 'weekly',
      scoringType: 'incremental',
      count: 1,
      totalCount: 3,
      streakDays: 3,
      completedDates: [TODAY, oneWeekAgo, twoWeeksAgo],
      completedBy: {
        [TODAY]: { [PAUL]: 1 },
        [oneWeekAgo]: { [PAUL]: 1 },
        [twoWeeksAgo]: { [PAUL]: 1 },
      },
      lastUpdated: new Date().toISOString(),
    };

    render(<HabitCard habit={positiveHabit} attribution={ROSTER} />);

    // The avatar's own label and the chip's label are now separate
    // announcements (they used to be one combined sentence on the ring).
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.getByText('3 week streak')).toBeInTheDocument();
    expect(screen.getAllByTestId('icon-flame')).toHaveLength(1);
  });
});

describe('HabitCard - React.memo comparator refreshes stale streak chips on out-of-period edits (F3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('re-renders when a back-dated (prior-week) edit changes a member streak, even though the current period fingerprint is unchanged', () => {
    // `attributionFingerprint`/`memberUnitsForPeriod` only reach the CURRENT
    // week's 7 days, so attributing two PRIOR weeks moves neither it nor
    // today's live `count`/`habit.streakDays` — the exact "changes a member's
    // own streak without moving today's counts" scenario. The comparator's
    // `habit.lastUpdated` equality check (which every attribution-writing
    // mutation bumps via `serverTimestamp()` in the same batch — see
    // useHabitActions' credit/uncredit/addHabitSubmission/etc.) is what makes
    // this row refresh anyway.
    const weekStart = habitPeriodStart('weekly', TODAY);
    const oneWeekAgo = format(subWeeks(parseISO(weekStart), 1), 'yyyy-MM-dd');
    const twoWeeksAgo = format(subWeeks(parseISO(weekStart), 2), 'yyyy-MM-dd');

    const before: Habit = {
      ...mockHabit,
      title: 'Weekly walk',
      period: 'weekly',
      scoringType: 'incremental',
      count: 1,
      totalCount: 1,
      streakDays: 1,
      completedDates: [TODAY],
      completedBy: { [TODAY]: { [PAUL]: 1 } },
      lastUpdated: new Date().toISOString(),
    };

    const { rerender } = render(<HabitCard habit={before} attribution={ROSTER} />);

    // Below the ember threshold (a lone week, streak 1): no streak text yet.
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.queryByText(/week streak/)).not.toBeInTheDocument();

    const after: Habit = {
      ...before,
      completedDates: [TODAY, oneWeekAgo, twoWeeksAgo],
      completedBy: {
        [TODAY]: { [PAUL]: 1 },
        [oneWeekAgo]: { [PAUL]: 1 },
        [twoWeeksAgo]: { [PAUL]: 1 },
      },
      // Every real attribution-writing mutation bumps this in the same batch.
      lastUpdated: new Date(Date.now() + 1000).toISOString(),
    };
    rerender(<HabitCard habit={after} attribution={ROSTER} />);

    // Paul's own weekly streak is now 3 (ember tier) — the row must refresh to
    // show it, proving the comparator did not treat `before`/`after` as equal.
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.getByText('3 week streak')).toBeInTheDocument();
  });
});

describe('HabitCard - attribution picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  const longPress = (element: HTMLElement) => {
    fireEvent.pointerDown(element, { clientX: 10, clientY: 10, button: 0 });
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.pointerUp(element);
    fireEvent.click(element);
  };

  it('opens on long-press and does NOT also increment the habit', () => {
    vi.useFakeTimers();
    try {
      render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);
      longPress(screen.getByLabelText('Toggle habit: Morning walk, current count: 1'));

      expect(screen.getByRole('menu', { name: 'Who completed Morning walk?' })).toBeInTheDocument();
      expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a short tap still increments (the long-press never fires)', () => {
    vi.useFakeTimers();
    try {
      render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);
      const toggle = screen.getByLabelText('Toggle habit: Morning walk, current count: 1');
      fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10, button: 0 });
      act(() => { vi.advanceTimersByTime(120); });
      fireEvent.pointerUp(toggle);
      fireEvent.click(toggle);

      expect(mockHouseholdContext.toggleHabit).toHaveBeenCalledWith('h1', 'up');
      expect(screen.queryByRole('menu', { name: /Who completed/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Touch does not always emit the trailing click after a long-press, so the
  // suppression flag must never survive into the NEXT gesture.
  it('does not swallow the tap that follows a click-less long-press', () => {
    vi.useFakeTimers();
    try {
      render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);
      const toggle = screen.getByLabelText('Toggle habit: Morning walk, current count: 1');

      // Long-press, release, and never fire a click (the touch case).
      fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10, button: 0 });
      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.pointerUp(toggle);

      // The very next tap must behave normally.
      fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10, button: 0 });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.pointerUp(toggle);
      fireEvent.click(toggle);

      expect(mockHouseholdContext.toggleHabit).toHaveBeenCalledWith('h1', 'up');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a press that turns into a scroll cancels the long-press', () => {
    vi.useFakeTimers();
    try {
      render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);
      const toggle = screen.getByLabelText('Toggle habit: Morning walk, current count: 1');
      fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.pointerMove(toggle, { clientX: 10, clientY: 90 });
      act(() => { vi.advanceTimersByTime(600); });

      expect(screen.queryByRole('menu', { name: /Who completed/ })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // A long-press can never be the ONLY path to an action.
  it('opens from the kebab’s "Who did this?" item', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    expect(screen.getByRole('menu', { name: 'Who completed Morning walk?' })).toBeInTheDocument();
  });

  it('credits an un-credited member, and un-credits a checked one', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    // Paul is already credited today → checked, and tapping him takes it back.
    const me = screen.getByRole('menuitemcheckbox', { name: /^Me/ });
    expect(me).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Tap to undo')).toBeInTheDocument();

    const jen = screen.getByRole('menuitemcheckbox', { name: /^Jen/ });
    expect(jen).toHaveAttribute('aria-checked', 'false');
    await user.click(jen);

    expect(mockHouseholdContext.creditHabitCompletion).toHaveBeenCalledWith('h1', [JEN]);
    expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();
  });

  it('un-credits the checked member', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));

    // F2: the un-credit target is now the member's most recent attributed
    // date within the CURRENT PERIOD, not an implicit "today" default — for a
    // daily habit (period === day) that is always today, i.e. TODAY here.
    expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, TODAY);
    expect(mockHouseholdContext.creditHabitCompletion).not.toHaveBeenCalled();
  });

  // Regression: the direct twin of the household submission-doc fix below —
  // a member credit logged via the past-day editor (`addHabitSubmission`
  // with an explicit actor) writes a `HabitSubmission` with
  // `attributedTo: memberId`, which the attribution-only
  // `uncreditHabitCompletion` never touches. Left un-deleted, it orphans
  // exactly like the household case once its date leaves `completedDates`.
  it('un-credits the checked member by deleting its own submission doc when one exists, leaving no orphan', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'mine', habitId: 'h1', date: TODAY, count: 1, attributedTo: PAUL,
        createdBy: PAUL, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));

    expect(mockHouseholdContext.getHabitSubmissions).toHaveBeenCalledWith('h1', TODAY, TODAY);
    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'mine');
    // Deleting the doc already reverses the habit + pool in one batch — the
    // attribution-only primitive must NOT ALSO run, or the reversal doubles.
    expect(mockHouseholdContext.uncreditHabitCompletion).not.toHaveBeenCalled();
  });

  // Guards the OTHER direction of the same bug class: `createdBy` is always
  // the tapping member regardless of who/what they credited, so the naive
  // `attributedTo ?? createdBy` fallback alone would match a household-credit
  // doc this member happens to have logged. That doc must survive a MEMBER
  // undo — deleting it would corrupt the pool's own unit instead of this
  // member's.
  it('member un-credit does not sweep up a household-credit doc logged by the same member', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'hh', habitId: 'h1', date: TODAY, count: 1, creditsHousehold: true,
        createdBy: PAUL, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));

    expect(mockHouseholdContext.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, TODAY);
  });

  // 🛡️ THE `?? createdBy` FALLBACK IS THE BUG, not a safety net.
  //
  // `addHabitSubmission` writes `attributedTo` on EVERY member-credited doc
  // (`actor !== null ? { attributedTo: actor } : { creditsHousehold: true }`),
  // so the fallback can never reach a doc this member is genuinely credited
  // for. The ONLY docs it can reach carry neither field — the automation
  // writers (`transactionMutations`' keyword fire, `noSpendFire`, the backfill
  // script) and pre-attribution history. On the keyword fire `createdBy` is
  // whoever VERIFIED the triggering transaction: a REAL member uid, routinely
  // the same admin who also logs habits by hand — this household's actual
  // situation.
  //
  // Matching one is not a no-op. `deleteHabitSubmission` resolves
  // `creditedUid = attributedTo ?? createdBy` and runs `reversalMoves`, so the
  // wrong doc is deleted AND the member's genuine `completedBy` unit is
  // debited (probed directly against the real mutation: it writes
  // `completedBy.<date>.<uid>: -1` and `-10` to that member's points).
  it('member un-credit does not sweep up an AUTOMATION doc whose createdBy is that same member', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      // Writer #2 (`transactionMutations`): NO attributedTo, NO creditsHousehold,
      // `createdBy` = the member who verified the triggering transaction.
      { id: 'automation', habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        createdBy: PAUL, createdAt: '2026-07-15T10:00:00',
        sourceTransactionId: 'txn-1' } as HabitSubmission,
    ]);
    // Paul ALSO holds one genuine attributed unit on this same date — the
    // attribution the mis-delete would destroy.
    render(
      <HabitCard habit={attributedHabit({ [PAUL]: 1 }, { count: 2 })} attribution={ROSTER} />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));

    // The automation doc survives…
    expect(mockHouseholdContext.deleteHabitSubmission).not.toHaveBeenCalled();
    // …and Paul's real unit is reversed by the attribution-only primitive,
    // which is bounded by `completedBy` and cannot over-take.
    expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, TODAY);
  });

  // 🛡️ PINS THE CHOSEN SEMANTICS of this PR's member-path change. Pre-fix,
  // `handleUncreditMember` ALWAYS called `uncreditHabitCompletion`, which
  // reverses exactly ONE unit. It now prefers the backing doc, and
  // `deleteHabitSubmission` decrements `count`/`totalCount` by the whole
  // `submission.count` — so one tap on a multi-unit doc clears all of it.
  //
  // Multi-unit attributed docs are ordinary, not a corner case:
  // `HabitSubmissionLogModal` passes a free-text count straight to
  // `addHabitSubmission(habit.id, count, …)`. The behaviour is deliberate and
  // matches `DayHabitEditor` (the shipped template this was ported from), so
  // this test exists to make any future move back to one-unit-at-a-time a
  // conscious decision rather than a silent regression.
  it('reverses ALL of a multi-unit attributed doc in one tap, not a single unit', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'three', habitId: 'h1', date: TODAY, count: 3, pointsEarned: 30,
        attributedTo: PAUL, createdBy: PAUL,
        createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    render(<HabitCard habit={attributedHabit({ [PAUL]: 3 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));

    // The whole doc goes — `deleteHabitSubmission` reverses its 3 units and the
    // 30 points it earned in one batch.
    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'three');
    // …and the one-unit primitive must NOT also run, or the day loses 4 units
    // for a doc that only ever recorded 3.
    expect(mockHouseholdContext.uncreditHabitCompletion).not.toHaveBeenCalled();
  });

  // --- Household credit mode ------------------------------------------------
  // The Household row is a THIRD meaning, not a rename of "Both of us": one
  // award, to the pool, to nobody — versus N awards and a pool paid N times.
  it('offers a Household row on EVERY habit, and it credits nobody', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    const household = screen.getByRole('menuitemcheckbox', { name: /^Household/ });
    // Paul's single unit IS the day's only unit, so nothing is unattributed.
    expect(household).toHaveAttribute('aria-checked', 'false');
    await user.click(household);

    expect(mockHouseholdContext.creditHouseholdCompletion).toHaveBeenCalledWith('h1');
    expect(mockHouseholdContext.creditHabitCompletion).not.toHaveBeenCalled();
    expect(mockHouseholdContext.toggleHabit).not.toHaveBeenCalled();
  });

  it('checks Household when the period holds a completion nobody is credited for', async () => {
    const user = userEvent.setup();
    // Two units, one of them Paul's → one unattributed unit remains.
    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { count: 2, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    const household = screen.getByRole('menuitemcheckbox', { name: /^Household/ });
    expect(household).toHaveAttribute('aria-checked', 'true');
    await user.click(household);

    expect(mockHouseholdContext.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', TODAY);
    expect(mockHouseholdContext.deleteHabitSubmission).not.toHaveBeenCalled();
  });

  // Regression: a household credit logged via the past-day editor / reflection
  // drawer (`addHabitSubmission`) writes a `HabitSubmission` doc with
  // `creditsHousehold: true` — unlike this row's own tap
  // (`creditHouseholdCompletion`), which writes no doc at all. Undoing from
  // THIS row must find and delete that doc rather than calling the
  // attribution-only `uncreditHouseholdCompletion`, or the doc outlives the
  // reversed completion and a later corrective recompute
  // (`pointsForHabitOnDate` reports a stored submission's points "as-is" once
  // its date leaves `completedDates`) silently re-credits the household pool
  // with the exact points this undo just took back — an orphan re-credit with
  // no attribution trail to find it by.
  it('undoes a household credit by deleting its own submission doc when one exists, leaving no orphan', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'hh', habitId: 'h1', date: TODAY, count: 1, createdBy: PAUL,
        creditsHousehold: true, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { count: 2, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));

    expect(mockHouseholdContext.getHabitSubmissions).toHaveBeenCalledWith('h1', TODAY, TODAY);
    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'hh');
    // The attribution-only primitive must NOT ALSO run — deleting the
    // submission doc already reverses the habit + pool in one batch (see
    // `deleteHabitSubmission`), so calling both would double-reverse.
    expect(mockHouseholdContext.uncreditHouseholdCompletion).not.toHaveBeenCalled();
  });

  // Reviewer-confirmed BLOCKING gap: a doc written before EITHER attribution
  // or household-credit existed carries neither `attributedTo` nor
  // `creditsHousehold`. Filtering on `creditsHousehold === true` alone lets
  // this shape fall through as "no doc found", so the undo takes the
  // attribution-only fallback and the grandfathered doc survives — the exact
  // orphan this PR exists to close, just wearing a different doc shape. The
  // probe at the end mirrors the reviewer's own reproduction: with the doc
  // gone (as this fix ensures), re-scoring the post-undo state must read 0,
  // not the doc's original stored award.
  it('sweeps up a GRANDFATHERED doc too (no attributedTo, no creditsHousehold) — the doc that orphaned before this fix', async () => {
    const user = userEvent.setup();
    const legacyPoints = 10;
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'legacy', habitId: 'h1', date: TODAY, count: 1, pointsEarned: legacyPoints,
        createdBy: PAUL, createdAt: '2026-07-15T08:00:00' } as HabitSubmission,
    ]);
    // Nobody attributed (`completedBy` empty) + count 1 → the unit reads as
    // household-credited regardless of which member-less doc shape backs it.
    render(
      <HabitCard
        habit={attributedHabit({}, { count: 1, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));

    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'legacy');
    expect(mockHouseholdContext.uncreditHouseholdCompletion).not.toHaveBeenCalled();

    // --- Reviewer's probe -----------------------------------------------
    // Simulates the state AFTER a real `deleteHabitSubmission` commit: the
    // habit doc's own reversal (count 0, TODAY out of completedDates — the
    // part `uncreditHouseholdCompletion` always did correctly) plus the
    // submission doc now GONE, so a fresh `fetchSubmissionTotals` would
    // return no entry for TODAY.
    const postUndoHabit: Habit = attributedHabit({}, { count: 0, completedDates: [], creditMode: 'household' });
    expect(pointsForHabitOnDate(postUndoHabit, TODAY, TODAY, new Map())).toBe(0);

    // Contrast: this is the reviewer's actual reproduction of the PRE-fix
    // bug — same post-undo habit state, but with the leftover doc's stored
    // total still present (i.e. `deleteHabitSubmission` was never called).
    // `pointsForHabitOnDate` reports it "as-is", silently re-crediting the
    // exact amount the undo above just reversed.
    const staleSubmissionTotals = new Map([[TODAY, { count: 1, points: legacyPoints }]]);
    expect(pointsForHabitOnDate(postUndoHabit, TODAY, TODAY, staleSubmissionTotals)).toBe(legacyPoints);
  });

  // Guards the OTHER direction the reviewer flagged: broadening the household
  // predicate to `attributedTo == null` must never reach INTO a doc some
  // OTHER member is actually credited for (`attributedTo` set) — that unit
  // belongs to them, not to the household, no matter how "unattributed" the
  // rest of the day looks.
  it('household un-credit does not sweep up a doc a specific member is attributed for', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'jens', habitId: 'h1', date: TODAY, count: 1, attributedTo: JEN,
        createdBy: JEN, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    // Two units: Jen's attributed one, plus one nobody holds → Household
    // reads checked for that second, genuinely unattributed unit.
    render(
      <HabitCard
        habit={attributedHabit({ [JEN]: 1 }, { count: 2, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));

    expect(mockHouseholdContext.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(mockHouseholdContext.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', TODAY);
  });

  // 🛡️ The household analogue of the member-path automation test above, and
  // the reason `attributedTo == null` ALONE is too wide.
  //
  // A grandfathered doc and an automation doc are FIELD-IDENTICAL — neither
  // carries `attributedTo` or `creditsHousehold` — so no marker separates
  // them. What separates the SAFE case from the corrupting one is the date:
  // `deleteHabitSubmission` falls back to `creditedUid = createdBy` for any
  // doc without `creditsHousehold`, and `resolveReversalSources` provably
  // returns `[]` only when the date carries no attribution at all. Probed
  // against the real mutation, a neither-field doc with `createdBy: user1`
  // on a date where SOMEONE holds attribution writes
  // `completedBy.<date>.<holder>: -1` and `-10` to that holder's points —
  // and the holder is whoever `completedBy` records, not necessarily
  // `createdBy`. So a mixed date must fall through to the attribution-only
  // primitive; the clean date (the genuine grandfathered case, covered
  // above) still sweeps.
  it('household un-credit does not sweep up an AUTOMATION doc on a date that carries attribution', async () => {
    const user = userEvent.setup();
    mockHouseholdContext.getHabitSubmissions.mockResolvedValueOnce([
      { id: 'automation', habitId: 'h1', date: TODAY, count: 1, pointsEarned: 10,
        createdBy: PAUL, createdAt: '2026-07-15T10:00:00',
        sourceTransactionId: 'txn-1' } as HabitSubmission,
    ]);
    // Two units: Paul's genuine attributed one, plus the automation's
    // unattributed one → Household reads checked for the second.
    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { count: 2, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));

    // Deleting it would have debited Paul's REAL `completedBy` unit.
    expect(mockHouseholdContext.deleteHabitSubmission).not.toHaveBeenCalled();
    expect(mockHouseholdContext.uncreditHouseholdCompletion).toHaveBeenCalledWith('h1', TODAY);
  });

  // Reviewer-confirmed BLOCKING gap: the old handler called `uncreditCompletion`
  // synchronously off `habitsRef.current` — zero async reads before its one
  // `batch.commit()`, so a double-tap couldn't race it. This fix inserts an
  // `await getHabitSubmissions(...)` before any write, and
  // `HabitAttributionPicker` closes itself SYNCHRONOUSLY before calling
  // `onUncreditHousehold()` — but `habit` is a prop that only updates once
  // Firestore's listener pushes the reversal back, so RE-OPENING the picker
  // mid-flight still shows Household checked. The reviewer's own probe:
  // open → tap Household → re-open → tap again, before the first read
  // resolves. Pre-guard this dispatched `getHabitSubmissions` (and
  // `deleteHabitSubmission`) TWICE with the same doc id — a double-debit of
  // the pool, since Firestore `increment()` deltas are not idempotent.
  it('a re-entrant tap before the submissions read resolves cannot double-dispatch (household)', async () => {
    const user = userEvent.setup();
    let resolveSubs!: (docs: HabitSubmission[]) => void;
    const deferred = new Promise<HabitSubmission[]>((resolve) => { resolveSubs = resolve; });
    mockHouseholdContext.getHabitSubmissions.mockReturnValueOnce(deferred);

    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { count: 2, creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );

    const openAndTapHousehold = async () => {
      await user.click(screen.getByLabelText('Options for Morning walk'));
      await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      await user.click(screen.getByRole('menuitemcheckbox', { name: /^Household/ }));
    };

    // First tap starts the async lookup and leaves it unresolved.
    await openAndTapHousehold();
    // Re-open and tap again while the first flow is still in flight — the
    // reviewer's exact reproduction.
    await openAndTapHousehold();

    // The guard blocks the second dispatch at the handler's own synchronous
    // entry, before it ever reaches the async read.
    expect(mockHouseholdContext.getHabitSubmissions).toHaveBeenCalledTimes(1);

    resolveSubs([
      { id: 'hh', habitId: 'h1', date: TODAY, count: 1, createdBy: PAUL,
        creditsHousehold: true, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    await waitFor(() => {
      expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledTimes(1);
    });
    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'hh');
  });

  // Direct twin of the household re-entrancy test above — same guard, same
  // shared ref, member path.
  it('a re-entrant tap before the submissions read resolves cannot double-dispatch (member)', async () => {
    const user = userEvent.setup();
    let resolveSubs!: (docs: HabitSubmission[]) => void;
    const deferred = new Promise<HabitSubmission[]>((resolve) => { resolveSubs = resolve; });
    mockHouseholdContext.getHabitSubmissions.mockReturnValueOnce(deferred);

    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    const openAndTapMe = async () => {
      await user.click(screen.getByLabelText('Options for Morning walk'));
      await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      await user.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ }));
    };

    await openAndTapMe();
    await openAndTapMe();

    expect(mockHouseholdContext.getHabitSubmissions).toHaveBeenCalledTimes(1);

    resolveSubs([
      { id: 'mine', habitId: 'h1', date: TODAY, count: 1, attributedTo: PAUL,
        createdBy: PAUL, createdAt: '2026-07-15T09:00:00' } as HabitSubmission,
    ]);
    await waitFor(() => {
      expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledTimes(1);
    });
    expect(mockHouseholdContext.deleteHabitSubmission).toHaveBeenCalledWith('h1', 'mine');
  });

  it('sorts Household FIRST on a household habit and LAST on a members habit', async () => {
    const user = userEvent.setup();
    const openPicker = async () => {
      await user.click(screen.getByLabelText('Options for Morning walk'));
      await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      return screen.getAllByRole('menuitemcheckbox').map(el => el.textContent ?? '');
    };

    const { unmount } = render(
      <HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />,
    );
    const membersRows = await openPicker();
    expect(membersRows[0]).not.toContain('Household');
    expect(membersRows[membersRows.length - 1]).toContain('Household');
    unmount();

    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { creditMode: 'household' })}
        attribution={ROSTER}
      />,
    );
    expect((await openPicker())[0]).toContain('Household');
  });

  it('"Both of us" credits only whoever is not credited yet', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitem', { name: /^Both of us/ }));

    expect(mockHouseholdContext.creditHabitCompletion).toHaveBeenCalledWith('h1', [JEN]);
  });

  it('"Both of us" is inert once everyone is credited', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1, [JEN]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    expect(screen.getByRole('menuitem', { name: /^Both of us/ })).toBeDisabled();
  });

  // 🔒 Regression (adversarial review, PR #1165). "Both of us" and "Household"
  // are the two most OPPOSITE outcomes on the sheet and sat adjacent, separated
  // by a 1px hairline. Undoing a mistaken "Both of us" costs TWO taps before
  // "Household" can even be picked, so the difference has to be legible BEFORE
  // the tap — not merely recoverable after it.
  it('spells out what each compound row does, and breaks Household off from the member rows', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    // Each compound row says what it actually does — and says it in the
    // ACCESSIBLE NAME, so a screen reader gets the same warning.
    expect(screen.getByRole('menuitem', { name: /^Both of us/ })).toHaveAccessibleName(
      /2 awards — one each/,
    );
    expect(screen.getByRole('menuitemcheckbox', { name: /^Household/ })).toHaveAccessibleName(
      /One award — nobody credited/,
    );
    // A plain member row carries no descriptor — only the compound ones do.
    expect(screen.getByRole('menuitemcheckbox', { name: /^Jen/ })).toHaveAccessibleName('Jen');

    // …and a group break sits between the member-ish rows and Household.
    const menu = screen.getByRole('menu', { name: /Who completed Morning walk/ });
    const separator = menu.querySelector('[role="separator"]');
    expect(separator).not.toBeNull();
    const rows = Array.from(
      menu.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"],[role="separator"]'),
    );
    // Members habit ⇒ Household sorts LAST, so the break is immediately above it.
    expect(rows.at(-2)).toBe(separator);
    expect(rows.at(-1)).toHaveAccessibleName(/^Household/);
  });

  it('keeps every picker row at the 44px minimum hit target', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    const menu = screen.getByRole('menu', { name: /Who completed Morning walk/ });
    const rows = menu.querySelectorAll('[role="menuitem"],[role="menuitemcheckbox"]');
    expect(rows.length).toBeGreaterThan(0);
    // jsdom has no layout, so the CONTRACT is asserted on the class that
    // provides it (min-h-11 = 2.75rem = 44px), which is what a descriptor-driven
    // height change could silently have dropped.
    for (const row of rows) expect(row.className).toContain('min-h-11');
  });

  it('lists adults only — managed kid profiles are excluded', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    expect(screen.queryByRole('menuitemcheckbox', { name: /Leo/ })).not.toBeInTheDocument();
  });

  it('does not carry the tap-press scale transform while held and the picker is open (paper cut: popover painting behind the sticky tab strip during a held long-press)', () => {
    vi.useFakeTimers();
    try {
      render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);
      const toggle = screen.getByLabelText('Toggle habit: Morning walk, current count: 1');
      // The button's DOM parent is the ListRow root (`leading` is a fragment,
      // so it contributes no wrapper element) — the same element the Popover
      // anchors to via `position: relative`.
      const row = toggle.parentElement as HTMLElement;

      // Baseline: the row normally carries the has-active scale utility.
      expect(row.className).toMatch(/has-\[\.main-overlay:active\]:scale-/);

      fireEvent.pointerDown(toggle, { clientX: 10, clientY: 10, button: 0 });
      act(() => { vi.advanceTimersByTime(600); });

      // The picker is now open and the pointer is still down (:active would
      // still match). The row must NOT carry the scale utility here, or the
      // transform it would apply creates a stacking context that traps the
      // (non-portalled) popover panel below the page's sticky tab strip for as
      // long as the press is held.
      expect(screen.getByRole('menu', { name: 'Who completed Morning walk?' })).toBeInTheDocument();
      expect(row.className).not.toMatch(/has-\[\.main-overlay:active\]:scale-/);

      fireEvent.pointerUp(toggle);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not offered for an ASSIGNED chore, whose points route to the assignee', async () => {
    const user = userEvent.setup();
    render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { assignedTo: 'kid_leo' })}
        attribution={ROSTER}
      />
    );

    await user.click(screen.getByLabelText('Options for Morning walk'));
    expect(screen.queryByRole('menuitem', { name: 'Who did this?' })).not.toBeInTheDocument();
  });
});

describe('HabitCard - attribution picker is PERIOD-scoped, not day-scoped (F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  // A fixed system clock (Wednesday of a known ISO week), so "credited Monday,
  // viewed Wednesday" is deterministic regardless of which real weekday the
  // suite happens to run on (see the weekday-dependent-test hazard) — every
  // date used below is derived from THIS clock, never real "today".
  const WEDNESDAY = '2024-02-14T12:00:00';
  const MONDAY = '2024-02-12'; // Monday of the same ISO week as WEDNESDAY

  it('shows a checkmark for a weekly habit credited earlier in the week (not just today)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(WEDNESDAY));
      const habit: Habit = {
        ...mockHabit,
        title: 'Morning walk',
        period: 'weekly',
        scoringType: 'incremental',
        count: 1,
        totalCount: 1,
        completedDates: [MONDAY],
        completedBy: { [MONDAY]: { [PAUL]: 1 } },
        lastUpdated: new Date().toISOString(),
      };
      render(<HabitCard habit={habit} attribution={ROSTER} />);

      fireEvent.click(screen.getByLabelText('Options for Morning walk'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

      // Credited MONDAY, viewed WEDNESDAY: still checked — the old day-scoped
      // read (`memberCompletionCount(habit, uid, today)`) would show Paul as
      // un-credited here and let a second tap double-credit a unit he already
      // holds this week.
      expect(screen.getByRole('menuitemcheckbox', { name: /^Me/ })).toHaveAttribute('aria-checked', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un-crediting a weekly checkmark reverses the day the unit actually lives on, not today', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(WEDNESDAY));
      const habit: Habit = {
        ...mockHabit,
        title: 'Morning walk',
        period: 'weekly',
        scoringType: 'incremental',
        count: 1,
        totalCount: 1,
        completedDates: [MONDAY],
        completedBy: { [MONDAY]: { [PAUL]: 1 } },
        lastUpdated: new Date().toISOString(),
      };
      render(<HabitCard habit={habit} attribution={ROSTER} />);

      fireEvent.click(screen.getByLabelText('Options for Morning walk'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      // The uncredit handler now does an async submissions read before
      // deciding which primitive to call — flush it explicitly rather than
      // relying on a bare fireEvent.click's synchronous return.
      await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ })); });

      // Reverses MONDAY's unit — the day it actually lives on. The old
      // day-scoped un-credit had no way to reach it at all (it always targeted
      // `today`, which holds nothing here), so this both fixes the missing
      // "un-credit Monday" affordance and rules out a double-credit from the
      // checkmark-visibility fix above.
      expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, MONDAY);
      expect(mockHouseholdContext.creditHabitCompletion).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('period-scopes a THRESHOLD weekly habit\'s picker too, and un-credits the day the unit lives on', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(WEDNESDAY));
      const habit: Habit = {
        ...mockHabit,
        title: 'Weekly review',
        period: 'weekly',
        scoringType: 'threshold',
        targetCount: 1,
        count: 1,
        totalCount: 1,
        completedDates: [MONDAY],
        completedBy: { [MONDAY]: { [PAUL]: 1 } },
        lastUpdated: new Date().toISOString(),
      };
      render(<HabitCard habit={habit} attribution={ROSTER} />);

      fireEvent.click(screen.getByLabelText('Options for Weekly review'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      expect(screen.getByRole('menuitemcheckbox', { name: /^Me/ })).toHaveAttribute('aria-checked', 'true');

      await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ })); });
      expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, MONDAY);
    } finally {
      vi.useRealTimers();
    }
  });

  it('regression: a DAILY habit still targets today, exactly as before (period === day)', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(WEDNESDAY));
      const today = getLocalDateString();
      const habit: Habit = {
        ...mockHabit,
        title: 'Morning walk',
        scoringType: 'incremental',
        count: 1,
        totalCount: 1,
        completedDates: [today],
        completedBy: { [today]: { [PAUL]: 1 } },
        lastUpdated: new Date().toISOString(),
      };
      render(<HabitCard habit={habit} attribution={ROSTER} />);

      fireEvent.click(screen.getByLabelText('Options for Morning walk'));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
      expect(screen.getByRole('menuitemcheckbox', { name: /^Me/ })).toHaveAttribute('aria-checked', 'true');

      await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /^Me/ })); });
      expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL, today);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('HabitCard - stale habit rendering (pending-reset guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  it('renders a stale habit (count > 0 from a previous day) as unselected', () => {
    // Completed yesterday, overnight auto-reset never ran: count is still 2 but
    // lastUpdated is yesterday, so the card must NOT render selected/active.
    render(
      <HabitCard
        habit={{ ...mockHabit, count: 2, totalCount: 2, lastUpdated: yesterdayIso }}
      />
    );

    // The X reset affordance only renders on an ACTIVE card.
    expect(screen.queryByLabelText('Reset habit progress')).not.toBeInTheDocument();
    // The toggle overlay reports the effective (reset-pending) count of 0.
    expect(
      screen.getByLabelText(`Toggle habit: ${mockHabit.title}, current count: 0`)
    ).toBeInTheDocument();
  });

  it('still renders a non-stale completed habit as selected', () => {
    render(
      <HabitCard
        habit={{ ...mockHabit, count: 1, totalCount: 1, lastUpdated: new Date().toISOString() }}
      />
    );

    expect(screen.getByLabelText('Reset habit progress')).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Toggle habit: ${mockHabit.title}, current count: 1`)
    ).toBeInTheDocument();
  });
});
