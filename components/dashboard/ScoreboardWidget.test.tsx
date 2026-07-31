import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { Habit, HabitSubmission, HouseholdMember, WeeklyRecap } from '@/types/schema';
import { buildMemberColorMap, memberColorFor } from '@/utils/memberColors';
import { calculateHouseholdPointsForDateRange, calculateMemberPointsForDateRange } from '@/utils/habitAttribution';
import { calculateHouseholdShareForDateRange } from '@/utils/scoreboardWidget';
import { ScoreboardWidget } from './ScoreboardWidget';

// The widget reads members + recaps (useHouseholdCore) and weeklyPoints/
// habits/getHabitSubmissions (useGamification) — drive each independently.
const mockMembers = vi.fn<() => HouseholdMember[]>(() => []);
const mockRecaps = vi.fn<() => WeeklyRecap[]>(() => []);
const mockWeeklyPoints = vi.fn<() => number>(() => 0);
const mockHabits = vi.fn<() => Habit[]>(() => []);
const mockGetHabitSubmissions =
  vi.fn<(habitId: string, startDate?: string, endDate?: string) => Promise<HabitSubmission[]>>(async () => []);
// Thursday inside the "current" Jul 27 - Aug 2 week — fixed so the week
// selector's options/boundaries are deterministic regardless of wall-clock date.
const mockToday = vi.fn(() => '2026-07-30');

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({ members: mockMembers(), recaps: mockRecaps() }),
  useGamification: () => ({
    weeklyPoints: mockWeeklyPoints(),
    habits: mockHabits(),
    getHabitSubmissions: mockGetHabitSubmissions,
  }),
}));

vi.mock('@/utils/dateHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/dateHelpers')>();
  return { ...actual, getLocalDateString: () => mockToday() };
});

const makeMember = (overrides: Partial<HouseholdMember> & Pick<HouseholdMember, 'uid' | 'displayName'>): HouseholdMember => ({
  role: 'member',
  points: { daily: 0, weekly: 0, total: 0 },
  ...overrides,
});

const makeHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h-1',
    title: 'Workout',
    category: 'Health',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-27T00:00:00.000Z',
    ...overrides,
  } as unknown as Habit);

describe('ScoreboardWidget', () => {
  beforeEach(() => {
    mockMembers.mockReturnValue([]);
    mockRecaps.mockReturnValue([]);
    mockWeeklyPoints.mockReturnValue(0);
    mockHabits.mockReturnValue([]);
    mockGetHabitSubmissions.mockReset();
    mockGetHabitSubmissions.mockImplementation(async () => []);
    mockToday.mockReturnValue('2026-07-30');
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
    // The hero is a row now: household badge + "Household" + the total. The
    // old "household total" label is gone (the owner struck "total").
    expect(within(screen.getByTestId('scoreboard-hero-row')).getByText('Household')).toBeInTheDocument();
    expect(screen.queryByText('household total')).not.toBeInTheDocument();
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

  describe('week selector (paper cut #3)', () => {
    it('mounts on the current week — the trigger reads "This week" even when past weeks have data', () => {
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 5, weekly: 40, total: 40 } }),
        makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 0, weekly: 10, total: 10 } }),
      ]);
      mockWeeklyPoints.mockReturnValue(50);
      mockHabits.mockReturnValue([
        makeHabit({ completedDates: ['2026-07-21'], completedBy: { '2026-07-21': { paul: 1 } } }),
      ]);

      render(<ScoreboardWidget />);

      // Component state only, never persisted — every mount starts here.
      expect(screen.getByRole('button', { name: /Select week/ })).toHaveTextContent('This week');
      // Still the LIVE current-week figures, not a past-week recompute.
      expect(screen.getByTestId('scoreboard-total')).toHaveTextContent('50');
    });

    it('offers only the current week when no habit was ever completed', () => {
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul' }),
        makeMember({ uid: 'jen', displayName: 'Jen' }),
      ]);

      render(<ScoreboardWidget />);
      fireEvent.click(screen.getByRole('button', { name: /Select week/ }));

      expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);
    });

    it('computes per-member standings for a past week that has attribution', async () => {
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul' }),
        makeMember({ uid: 'jen', displayName: 'Jen' }),
      ]);
      const habits = [
        makeHabit({
          id: 'h-past',
          type: 'positive',
          scoringType: 'incremental',
          period: 'daily',
          basePoints: 10,
          completedDates: ['2026-07-21', '2026-07-22'],
          completedBy: { '2026-07-21': { paul: 2 }, '2026-07-22': { jen: 1 } },
        }),
      ];
      mockHabits.mockReturnValue(habits);

      render(<ScoreboardWidget />);
      fireEvent.click(screen.getByRole('button', { name: /Select week/ }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Jul 20 – Jul 26' }));

      // Expected figures come from the SAME production scorers the widget
      // calls — this test is about the widget's wiring into them, not a
      // re-derivation of the attribution math (which is unit-tested in
      // utils/habitAttribution.test.ts).
      const expectedTotal = calculateHouseholdPointsForDateRange(habits, '2026-07-20', '2026-07-26', '2026-07-30');
      const expectedPaul = calculateMemberPointsForDateRange(habits, 'paul', '2026-07-20', '2026-07-26', '2026-07-30');
      const expectedJen = calculateMemberPointsForDateRange(habits, 'jen', '2026-07-20', '2026-07-26', '2026-07-30');
      expect(expectedPaul).toBeGreaterThan(expectedJen);
      expect(expectedJen).toBeGreaterThan(0);

      expect(await screen.findByTestId('scoreboard-total')).toHaveTextContent(String(expectedTotal));
      // Paul strictly leads — exactly one crown.
      expect(screen.getAllByText('Leading')).toHaveLength(1);
      expect(screen.getByText(String(expectedPaul))).toBeInTheDocument();
      expect(screen.getByText(String(expectedJen))).toBeInTheDocument();
      // No "N today" sub-label — "today" isn't a meaningful concept for a
      // week that already ended.
      expect(screen.queryByText(/\d+ today/)).not.toBeInTheDocument();
    });

    it('shows a household total but no fabricated per-person rows for a grandfathered (pre-attribution) week', async () => {
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul' }),
        makeMember({ uid: 'jen', displayName: 'Jen' }),
      ]);
      // completedDates with no completedBy counterpart at all — a completion
      // recorded before per-member attribution existed.
      const habits = [makeHabit({ id: 'h-grandfathered', completedDates: ['2026-07-14'], completedBy: undefined })];
      mockHabits.mockReturnValue(habits);

      render(<ScoreboardWidget />);
      fireEvent.click(screen.getByRole('button', { name: /Select week/ }));
      fireEvent.click(screen.getByRole('menuitemradio', { name: 'Jul 13 – Jul 19' }));

      expect(await screen.findByText("Per-person scores aren't available for this week yet.")).toBeInTheDocument();
      expect(screen.queryByTestId('scoreboard-avatar-paul')).not.toBeInTheDocument();
      expect(screen.queryByTestId('scoreboard-avatar-jen')).not.toBeInTheDocument();
      expect(screen.queryByText('Leading')).not.toBeInTheDocument();
      // The household total for this week is still real (not zeroed out).
      const expectedTotal = calculateHouseholdPointsForDateRange(habits, '2026-07-13', '2026-07-19', '2026-07-30');
      expect(expectedTotal).toBeGreaterThan(0);
      expect(screen.getByTestId('scoreboard-total')).toHaveTextContent(String(expectedTotal));
    });
  });

  describe('hero row (household hero restructure)', () => {
    it('renders the household badge, the "Household" label and the total on one row', () => {
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 45, weekly: 285, total: 900 } }),
        makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 60, weekly: 325, total: 950 } }),
      ]);
      mockWeeklyPoints.mockReturnValue(610);

      render(<ScoreboardWidget />);

      const heroRow = within(screen.getByTestId('scoreboard-hero-row'));
      expect(heroRow.getByTestId('scoreboard-hero-badge')).toBeInTheDocument();
      expect(heroRow.getByText('Household')).toBeInTheDocument();
      expect(heroRow.getByTestId('scoreboard-total')).toHaveTextContent('610');
    });

    it('keeps the trend chip and the best-week note on the hero subtitle line, not on the points edge', () => {
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
          ],
          upcomingBills: [],
          narrative: '',
          narrativeSource: 'template',
          premium: true,
        },
      ]);

      render(<ScoreboardWidget />);

      const heroRow = within(screen.getByTestId('scoreboard-hero-row'));
      expect(heroRow.getByText('12% vs last week')).toBeInTheDocument();
      expect(heroRow.getByText('Best week this month')).toBeInTheDocument();
    });
  });

  describe('Shared habits row (household-points-visibility)', () => {
    // Current week is Jul 27 - Aug 2 (mockToday = Thu Jul 30). The current-week
    // Household row is now sourced from an async `submissionTotals` fetch (see
    // ScoreboardWidget.tsx), so every test in this block awaits it settling —
    // `findByTestId` polls until the row appears; `act(async () => {})` flushes
    // the fetch before asserting an ABSENCE, so that assertion can't pass
    // vacuously just because the fetch hasn't resolved yet.
    it('shows a Household row whose value the visible rows sum exactly to the household total', async () => {
      // A legacy (pre-attribution) completion inside the current week — no
      // `completedBy` at all, so it belongs to nobody: the household-only
      // share of `weeklyPoints`.
      const habits = [
        makeHabit({ id: 'h-legacy', completedDates: ['2026-07-28'], completedBy: undefined }),
      ];
      mockHabits.mockReturnValue(habits);
      const expectedHouseholdShare = calculateHouseholdShareForDateRange(habits, '2026-07-27', '2026-07-30', '2026-07-30');
      expect(expectedHouseholdShare).toBeGreaterThan(0);

      // Weekly values deliberately distinct from `expectedHouseholdShare` and
      // from each other, so the DOM assertions below can't pass by accident.
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 5, weekly: 44, total: 44 } }),
        makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 0, weekly: 17, total: 17 } }),
      ]);
      const total = 44 + 17 + expectedHouseholdShare;
      mockWeeklyPoints.mockReturnValue(total);

      render(<ScoreboardWidget />);

      expect(screen.getByTestId('scoreboard-total')).toHaveTextContent(String(total));
      const householdRow = await screen.findByTestId('scoreboard-household-row');
      // Labelled "Shared habits", not "Household" — the hero row above is the
      // household now, and two identically-badged "Household" rows would be
      // indistinguishable.
      expect(householdRow).toHaveTextContent('Shared habits');
      expect(householdRow).toHaveTextContent(String(expectedHouseholdShare));
      // Paul (44) and Jen (17) each still render their own weekly value.
      expect(screen.getByText('44')).toBeInTheDocument();
      expect(screen.getByText('17')).toBeInTheDocument();

      // The three visible rows — Paul, Jen, Household — sum EXACTLY to the
      // displayed household total (constructed that way above; the point of
      // this test is that the WIDGET, not the fixture, produces
      // `expectedHouseholdShare` via the production scorer rather than any
      // other value).
      expect(44 + 17 + expectedHouseholdShare).toBe(total);
    });

    it('omits the Shared habits row when there is no unattributed remainder', async () => {
      // Fully attributed — nothing left for the household pool alone.
      const habits = [
        makeHabit({ id: 'h-attributed', completedDates: ['2026-07-28'], completedBy: { '2026-07-28': { paul: 1 } } }),
      ];
      mockHabits.mockReturnValue(habits);
      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 10, weekly: 10, total: 10 } }),
        makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 0, weekly: 0, total: 0 } }),
      ]);
      mockWeeklyPoints.mockReturnValue(10);

      render(<ScoreboardWidget />);
      // Let the current-week submission fetch settle before asserting an
      // absence — otherwise this would pass trivially while the row is just
      // still loading.
      await act(async () => {});

      // Asserts the SHARE ROW is gone — queried by testid, not by the bare
      // string "Household", which the hero row now always renders.
      expect(screen.queryByTestId('scoreboard-household-row')).not.toBeInTheDocument();
      expect(screen.queryByText('Shared habits')).not.toBeInTheDocument();
      // …while the hero, which is a different thing, still stands.
      expect(within(screen.getByTestId('scoreboard-hero-row')).getByText('Household')).toBeInTheDocument();
    });

    it('includes a stored submission that OUTLIVES its completion date in the CURRENT week — a reverted toggle must not silently zero out the Household row (finding 1)', async () => {
      // A legacy incremental habit whose completion was reverted — the date
      // is gone from `completedDates` — but its submission doc (worth -20)
      // still stands: a down-toggle removes the completion date but never
      // deletes the submission (see `pointsForHabitOnDate`'s doc comment in
      // utils/habitLogic.ts). `usePointsSync`'s corrective recompute DOES
      // fold this into the canonical `weeklyPoints` figure, so the Household
      // row must too, or the visible rows stop summing to the total.
      const habits = [
        makeHabit({
          id: 'h-reverted',
          type: 'negative',
          scoringType: 'incremental',
          basePoints: 20,
          hasSubmissionTracking: true,
          completedDates: [],
          completedBy: undefined,
        }),
      ];
      mockHabits.mockReturnValue(habits);
      mockGetHabitSubmissions.mockImplementation(async (habitId) => {
        if (habitId !== 'h-reverted') return [];
        const submission: HabitSubmission = {
          id: 's-reverted',
          habitId: 'h-reverted',
          habitTitle: 'Workout',
          timestamp: '2026-07-28T20:00:00.000Z',
          date: '2026-07-28',
          count: 1,
          pointsEarned: -20,
          streakDaysAtTime: 1,
          multiplierApplied: 1,
          createdBy: 'paul',
          createdAt: '2026-07-28T20:00:00.000Z',
        };
        return [submission];
      });

      mockMembers.mockReturnValue([
        makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 5, weekly: 44, total: 44 } }),
        makeMember({ uid: 'jen', displayName: 'Jen', points: { daily: 0, weekly: 17, total: 17 } }),
      ]);
      // The canonical stored total — as `usePointsSync` would have written it
      // — already includes the -20.
      const total = 44 + 17 - 20;
      mockWeeklyPoints.mockReturnValue(total);

      render(<ScoreboardWidget />);

      const householdRow = await screen.findByTestId('scoreboard-household-row');
      expect(householdRow).toHaveTextContent('-20');
      expect(screen.getByTestId('scoreboard-total')).toHaveTextContent(String(total));
      // The visible rows — Paul (44), Jen (17), Household (-20) — sum EXACTLY
      // to the displayed total, which is the invariant this feature exists
      // to guarantee.
      expect(44 + 17 + -20).toBe(total);
    });

    describe('submission fetch caching (perf: avoid re-fetch on every habit toggle)', () => {
      // The Dashboard (and hence this always-mounted widget) re-renders on
      // every Firestore habits snapshot, which arrives with a fresh array
      // identity on every single habit toggle. Without a fingerprint cache,
      // that snapshot alone was enough to re-issue a `getHabitSubmissions`
      // query per `hasSubmissionTracking` habit — see
      // `submissionCacheKey`'s doc comment in utils/habitSubmissionTotals.ts.
      //
      // `ScoreboardWidget` is wrapped in `React.memo` with no props, so a
      // parent-driven `rerender()` is a no-op; these tests force a genuine
      // re-render via a real user interaction (opening the week menu) that
      // flips internal state, then swap the mocked `habits` return value in
      // between clicks to simulate a fresh snapshot.
      const trackedHabit = (lastUpdated: string) =>
        makeHabit({
          id: 'h-tracked',
          type: 'positive',
          scoringType: 'incremental',
          basePoints: 10,
          hasSubmissionTracking: true,
          completedDates: ['2026-07-28'],
          completedBy: { '2026-07-28': { paul: 1 } },
          lastUpdated,
        });

      beforeEach(() => {
        mockMembers.mockReturnValue([
          makeMember({ uid: 'paul', displayName: 'Paul', points: { daily: 5, weekly: 44, total: 44 } }),
        ]);
      });

      it('does not re-fetch when re-rendered with a new habits array identity but an unchanged fingerprint', async () => {
        mockHabits.mockReturnValue([trackedHabit('2026-07-28T12:00:00.000Z')]);
        render(<ScoreboardWidget />);
        await act(async () => {});
        expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(1);

        // A fresh array/object identity (as every Firestore snapshot has)
        // but the SAME tracked habit's lastUpdated — nothing that could have
        // touched a submission.
        mockHabits.mockReturnValue([trackedHabit('2026-07-28T12:00:00.000Z')]);
        fireEvent.click(screen.getByRole('button', { name: /Select week/ }));
        await act(async () => {});

        expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(1);
      });

      it('re-fetches once a tracked habit\'s lastUpdated actually changes', async () => {
        mockHabits.mockReturnValue([trackedHabit('2026-07-28T12:00:00.000Z')]);
        render(<ScoreboardWidget />);
        await act(async () => {});
        expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(1);

        // A submission mutation stamps the habit doc's lastUpdated, which
        // arrives on the live listener as a new snapshot.
        mockHabits.mockReturnValue([trackedHabit('2026-07-28T18:00:00.000Z')]);
        fireEvent.click(screen.getByRole('button', { name: /Select week/ }));
        await act(async () => {});

        expect(mockGetHabitSubmissions).toHaveBeenCalledTimes(2);
      });
    });
  });
});
