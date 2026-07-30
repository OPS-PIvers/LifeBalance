import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HouseholdMember, WeeklyRecap } from '@/types/schema';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { ScoreboardWidget } from './ScoreboardWidget';

// The widget reads members + recaps (useHouseholdCore) and weeklyPoints
// (useGamification) — drive each independently.
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockRecaps = vi.fn<() => WeeklyRecap[]>(() => []);
const mockWeeklyPoints = vi.fn<() => number>(() => 0);

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ members: mockMembers(), recaps: mockRecaps() }),
  useGamification: () => ({ weeklyPoints: mockWeeklyPoints() }),
}));

const makeMember = (overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>): HouseholdMember => ({
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

describe('ScoreboardWidget', () => {
  beforeEach(() => {
    mockMembers.mockReturnValue([]);
    mockRecaps.mockReturnValue([]);
    mockWeeklyPoints.mockReturnValue(0);
  });

  it('renders nothing when there are no adult members', () => {
    mockMembers.mockReturnValue([
      makeMember({ uid: 'kid_leo', displayName: 'Leo', isManaged: true }),
    ]);

    const { container } = render(<ScoreboardWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a quiet zero state before any member has points, without hiding the widget', () => {
    mockMembers.mockReturnValue([
      makeMember({ uid: 'paul', displayName: 'Paul' }),
      makeMember({ uid: 'jen', displayName: 'Jen' }),
    ]);
    mockWeeklyPoints.mockReturnValue(0);

    render(<ScoreboardWidget />);

    expect(screen.getByText('Scoreboard')).toBeInTheDocument();
    expect(screen.getByTestId('scoreboard-total')).toHaveTextContent('0');
    expect(screen.getByText('household total')).toBeInTheDocument();
    expect(screen.getByText('Paul')).toBeInTheDocument();
    expect(screen.getByText('Jen')).toBeInTheDocument();
    // No crown when nobody has led — queried via the sr-only "Leading" marker.
    expect(screen.queryByText('Leading')).not.toBeInTheDocument();
    // No trend chip without recap history.
    expect(screen.queryByText(/vs last week/)).not.toBeInTheDocument();
    expect(screen.queryByText('Best week this month')).not.toBeInTheDocument();
  });

  it('renders two adults with distinct standings and crowns the strict leader', () => {
    mockMembers.mockReturnValue([
      makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 45, weekly: 285, total: 900 } }),
      makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 60, weekly: 325, total: 950 } }),
    ]);
    mockWeeklyPoints.mockReturnValue(610);

    render(<ScoreboardWidget />);

    expect(screen.getByTestId('scoreboard-total')).toHaveTextContent('610');
    expect(screen.getByText('60 today')).toBeInTheDocument();
    expect(screen.getByText('45 today')).toBeInTheDocument();
    expect(screen.getByText('325')).toBeInTheDocument();
    expect(screen.getByText('285')).toBeInTheDocument();
    // Jen leads (325 > 285) — exactly one crown.
    expect(screen.getAllByText('Leading')).toHaveLength(1);

    // Jen's name renders before Paul's — the leader sorts first.
    const names = screen.getAllByText(/^(Paul|Jen)$/).map(el => el.textContent);
    expect(names).toEqual(['Jen', 'Paul']);
  });

  it('shows the trend chip and best-week label derived from recap history', () => {
    mockMembers.mockReturnValue([
      makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 285, total: 900 } }),
      makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 10, weekly: 325, total: 950 } }),
    ]);
    mockWeeklyPoints.mockReturnValue(610);
    mockRecaps.mockReturnValue([
      {
        id: '2026-W30',
        isoWeek: '2026-W30',
        generatedAt: '2026-07-27T12:00:00.000Z',
        totalSpend: 0,
        priorWeekSpend: 0,
        topCategoryDeltas: [],
        habitCompletions: 0,
        streaksAtRisk: [],
        pointsByMember: [
          { memberId: 'paul', name: 'Paul', points: 245 },
          { memberId: 'jen', name: 'Jen', points: 300 },
        ], // total 545 -> (610-545)/545 = +12%
        upcomingBills: [],
        narrative: '',
        narrativeSource: 'template',
        premium: true,
      },
    ]);

    render(<ScoreboardWidget />);

    expect(screen.getByText('12% vs last week')).toBeInTheDocument();
    expect(screen.getByText('Best week this month')).toBeInTheDocument();
  });

  it('colors each standing row through the shared MemberColorMap (memberColorFor), not a uid-hashed resolveAvatarColor', () => {
    const members = [
      makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 45, weekly: 285, total: 900 } }),
      makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 60, weekly: 325, total: 950 } }),
    ];
    mockMembers.mockReturnValue(members);
    mockWeeklyPoints.mockReturnValue(610);

    render(<ScoreboardWidget />);

    const colors = buildMemberColorMap(members);
    const paulAvatar = screen.getByTestId('scoreboard-avatar-paul');
    const jenAvatar = screen.getByTestId('scoreboard-avatar-jen');
    expect(paulAvatar).toHaveStyle({ backgroundColor: memberColorFor(colors, 'paul') });
    expect(jenAvatar).toHaveStyle({ backgroundColor: memberColorFor(colors, 'jen') });
    // Pin against the palette's known assignment order so a regression to
    // uid-hashing (which would swap these two) is caught concretely, not just
    // "matches whatever the util says today".
    expect(memberColorFor(colors, 'paul')).toBe('#285742'); // first adult — evergreen
    expect(memberColorFor(colors, 'jen')).toBe('#b87a29'); // second adult — amber
  });

  it('excludes managed kids from the standings even when they have points', () => {
    mockMembers.mockReturnValue([
      makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 50, total: 50 } }),
      makeMember({ uid: 'kid_leo', displayName: 'Leo', isManaged: true, points: { daily: 999, weekly: 999, total: 999 } }),
    ]);

    render(<ScoreboardWidget />);

    expect(screen.getByText('Paul')).toBeInTheDocument();
    expect(screen.queryByText('Leo')).not.toBeInTheDocument();
  });
});
