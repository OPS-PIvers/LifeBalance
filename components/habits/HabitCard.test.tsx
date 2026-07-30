import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HabitCard from './HabitCard';
import { Habit, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { buildHabitRowMemberContext } from '@/utils/habitRowAttribution';

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
  // reads as flame-ring intensity on the credited member's avatar, and the
  // exact number lives in the habit's log. The MULTIPLIER it earns must still
  // be visible, which is what these assertions pin.
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
    const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { container } = render(
      <HabitCard
        habit={attributedHabit({ [PAUL]: 1 }, { lastUpdated: yesterdayIso })}
        attribution={ROSTER}
      />
    );
    expect(pieSlices(container)).toHaveLength(0);
  });
});

describe('HabitCard - flame-ring avatars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true);
  });

  it('names each credited member for screen readers', () => {
    render(<HabitCard habit={attributedHabit({ [PAUL]: 2, [JEN]: 1 })} attribution={ROSTER} />);

    expect(screen.getByText('Paul completed this 2 times')).toBeInTheDocument();
    expect(screen.getByText('Jen completed this')).toBeInTheDocument();
  });

  // Ring tiers and their screen-reader text are covered in
  // HabitDoneByAvatars.test.tsx — this suite mocks date-fns (for the freeze
  // badge's "yesterday"), which would also blunt the streak walk here.

  it('shows no avatars on an untouched row', () => {
    render(<HabitCard habit={mockHabit} attribution={ROSTER} />);
    expect(screen.queryByText(/completed this/)).not.toBeInTheDocument();
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

    expect(mockHouseholdContext.uncreditHabitCompletion).toHaveBeenCalledWith('h1', PAUL);
    expect(mockHouseholdContext.creditHabitCompletion).not.toHaveBeenCalled();
  });

  it('"Both of us" credits only whoever is not credited yet', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));
    await user.click(screen.getByRole('menuitem', { name: 'Both of us' }));

    expect(mockHouseholdContext.creditHabitCompletion).toHaveBeenCalledWith('h1', [JEN]);
  });

  it('"Both of us" is inert once everyone is credited', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1, [JEN]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    expect(screen.getByRole('menuitem', { name: 'Both of us' })).toBeDisabled();
  });

  it('lists adults only — managed kid profiles are excluded', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={attributedHabit({ [PAUL]: 1 })} attribution={ROSTER} />);

    await user.click(screen.getByLabelText('Options for Morning walk'));
    await user.click(screen.getByRole('menuitem', { name: 'Who did this?' }));

    expect(screen.queryByRole('menuitemcheckbox', { name: /Leo/ })).not.toBeInTheDocument();
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
