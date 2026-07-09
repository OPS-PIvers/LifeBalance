import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Habit, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import { KidsChoresWidget } from './KidsChoresWidget';

// --- Mocks -------------------------------------------------------------------
// The widget reads three things: members (useHouseholdCore), habits
// (useGamification), and the Kid Mode flag (useKidModeEnabled). We drive each
// independently so every dormancy gate can be exercised in isolation.
const mockUseKidModeEnabled = vi.fn<() => boolean>(() => false);
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockHabits = vi.fn<() => Habit[]>(() => []);

vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => mockUseKidModeEnabled(),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ members: mockMembers() }),
  useGamification: () => ({ habits: mockHabits() }),
}));

const TODAY = getLocalDateString();

const makeKid = (overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
  uid: 'kid_1',
  displayName: 'Ada',
  role: 'member',
  points: { daily: 12, weekly: 30, total: 100 },
  isManaged: true,
  ...overrides,
});

const makeChore = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'chore_1',
  title: 'Make bed',
  category: 'Chores',
  type: 'positive',
  basePoints: 5,
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: `${TODAY}T00:00:00.000Z`,
  assignedTo: 'kid_1',
  ...overrides,
});

describe('KidsChoresWidget', () => {
  beforeEach(() => {
    mockUseKidModeEnabled.mockReturnValue(false);
    mockMembers.mockReturnValue([]);
    mockHabits.mockReturnValue([]);
  });

  it('returns null when Kid Mode is disabled', () => {
    // Even with a managed kid + an assigned chore present, the flag gate wins.
    mockUseKidModeEnabled.mockReturnValue(false);
    mockMembers.mockReturnValue([makeKid()]);
    mockHabits.mockReturnValue([makeChore()]);

    const { container } = render(<KidsChoresWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when there are no managed kids with chores', () => {
    mockUseKidModeEnabled.mockReturnValue(true);

    // Case A: a managed kid but no chores assigned to them.
    mockMembers.mockReturnValue([makeKid()]);
    mockHabits.mockReturnValue([]);
    const { container: noChores } = render(<KidsChoresWidget />);
    expect(noChores).toBeEmptyDOMElement();

    // Case B: a chore exists but the only member is a regular (unmanaged) parent.
    mockMembers.mockReturnValue([
      makeKid({ uid: 'parent_1', displayName: 'Grace', isManaged: false }),
    ]);
    mockHabits.mockReturnValue([makeChore({ assignedTo: 'parent_1' })]);
    const { container: noKids } = render(<KidsChoresWidget />);
    expect(noKids).toBeEmptyDOMElement();
  });

  it('renders a kid name and chore count when a managed kid has an assigned daily chore', () => {
    mockUseKidModeEnabled.mockReturnValue(true);
    mockMembers.mockReturnValue([makeKid()]);
    mockHabits.mockReturnValue([
      makeChore({ id: 'c1', title: 'Make bed', completedDates: [TODAY] }),
      makeChore({ id: 'c2', title: 'Feed dog', completedDates: [] }),
    ]);

    render(<KidsChoresWidget />);

    expect(screen.getByText('Ada')).toBeInTheDocument();
    // One of two chores completed today.
    expect(screen.getByText('1/2 chores done today')).toBeInTheDocument();
    // Daily points balance surfaced.
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
