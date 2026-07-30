import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Habit, Household } from '@/types/schema';

// --- Firestore mock (capture pattern shared with useHabitActions.test) ------

interface CapturedUpdate {
  ref: { __path: string };
  data: Record<string, unknown>;
}

const capturedUpdates: CapturedUpdate[] = [];

const incrementMock = vi.fn((n: number) => ({ __increment: n }));
const getDocsMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path?: string, id?: string) => ({
    __path: id ? `${path}/${id}` : (path ?? '__autoId'),
  })),
  collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  increment: (n: number) => incrementMock(n),
  getDocs: (...args: unknown[]) => getDocsMock(...args),
  writeBatch: vi.fn(() => ({
    update: (ref: { __path: string }, data: Record<string, unknown>) => {
      capturedUpdates.push({ ref, data });
    },
    commit: vi.fn(async () => {}),
  })),
}));

vi.mock('@/firebase.config', () => ({ db: {} }));

import { needsNegativePointsRepair, repairNegativePointsCorruption } from './negativePointsRepair';
import { calculateHouseholdPointsForDate } from '@/utils/habitAttribution';
import { calculatePointsForDate } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';

const HOUSEHOLD_ID = 'house1';
const householdPath = `households/${HOUSEHOLD_ID}`;

const createHabit = (overrides: Partial<Habit>): Habit => ({
  id: 'h1',
  title: 'Missed meds',
  category: 'Health',
  type: 'negative',
  basePoints: 2,
  scoringType: 'incremental',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: new Date().toISOString(),
  ...overrides,
} as Habit);

const submissionsSnap = (subs: { pointsEarned: number }[]) => ({
  docs: subs.map((s, i) => ({
    id: `s${i}`,
    data: () => ({ count: 1, ...s }),
  })),
});

describe('needsNegativePointsRepair', () => {
  it('is false once the marker is stamped', () => {
    const household = { negativePointsRepairedAt: '2026-07-01T00:00:00Z' } as Household;
    const habits = [createHabit({ hasSubmissionTracking: true })];
    expect(needsNegativePointsRepair(household, habits)).toBe(false);
  });

  it('is true for an unstamped household with a submission-tracked negative habit', () => {
    const household = {} as Household;
    const habits = [createHabit({ hasSubmissionTracking: true })];
    expect(needsNegativePointsRepair(household, habits)).toBe(true);
  });

  it('is false when no negative habit ever used submissions', () => {
    const household = {} as Household;
    const habits = [
      createHabit({ hasSubmissionTracking: false }),
      createHabit({ id: 'p1', type: 'positive', hasSubmissionTracking: true }),
    ];
    expect(needsNegativePointsRepair(household, habits)).toBe(false);
  });
});

describe('repairNegativePointsCorruption', () => {
  beforeEach(() => {
    capturedUpdates.length = 0;
    incrementMock.mockClear();
    getDocsMock.mockReset();
  });

  it('flips wrongly-positive submissions, nudges total by the exact delta, and stamps the marker', async () => {
    // Two corrupted submissions (+2, +3) and one already-correct one (-2).
    getDocsMock.mockResolvedValue(
      submissionsSnap([{ pointsEarned: 2 }, { pointsEarned: 3 }, { pointsEarned: -2 }])
    );
    const habits = [createHabit({ hasSubmissionTracking: true })];

    await repairNegativePointsCorruption(HOUSEHOLD_ID, habits);

    // Submission flips: +2 → -2 and +3 → -3; the -2 one untouched.
    const subUpdates = capturedUpdates.filter(u => u.ref.__path.includes('/submissions/'));
    expect(subUpdates).toHaveLength(2);
    expect(
      subUpdates.map(u => u.data['pointsEarned'] as number).sort((a, b) => a - b)
    ).toEqual([-3, -2]);

    // Household points: total corrected by (-2-2) + (-3-3) = -10; daily/weekly
    // recomputed outright; marker stamped.
    const hh = capturedUpdates.find(u => u.ref.__path === householdPath);
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toEqual({ __increment: -10 });
    expect(hh!.data['points.daily']).toBe(0);
    expect(hh!.data['points.weekly']).toBe(0);
    expect(typeof hh!.data['negativePointsRepairedAt']).toBe('string');
  });

  it('still stamps the marker (and recomputes) when nothing was corrupted', async () => {
    getDocsMock.mockResolvedValue(submissionsSnap([{ pointsEarned: -2 }]));
    const habits = [createHabit({ hasSubmissionTracking: true })];

    await repairNegativePointsCorruption(HOUSEHOLD_ID, habits);

    const subUpdates = capturedUpdates.filter(u => u.ref.__path.includes('/submissions/'));
    expect(subUpdates).toHaveLength(0);

    const hh = capturedUpdates.find(u => u.ref.__path === householdPath);
    expect(hh).toBeDefined();
    expect(hh!.data['points.total']).toBeUndefined(); // no delta → no total nudge
    expect(typeof hh!.data['negativePointsRepairedAt']).toBe('string');
  });

  it('recomputes the household daily/weekly with the Σ-member scorer, not the legacy one', async () => {
    // 🔒 Regression (adversarial review, PR #1155). This repair fires at LOGIN
    // and writes points.daily/weekly ABSOLUTELY, so scoring with the pre-flip
    // habit-level helpers would stamp pre-flip numbers over the Σ-model pool.
    // A threshold habit both members completed today pays the household TWICE
    // under the competition model and once under the legacy scorer.
    getDocsMock.mockResolvedValue(submissionsSnap([{ pointsEarned: 2 }]));
    const today = getLocalDateString();
    const shared = createHabit({
      id: 'shared1',
      title: 'Walk the dog',
      type: 'positive',
      scoringType: 'threshold',
      basePoints: 10,
      targetCount: 1,
      count: 1,
      completedDates: [today],
      completedBy: { [today]: { paul: 1, jen: 1 } },
    });
    const habits = [createHabit({ hasSubmissionTracking: true }), shared];

    // The two models genuinely disagree on this fixture.
    expect(calculatePointsForDate(habits, today)).toBe(10);
    expect(calculateHouseholdPointsForDate(habits, today, today)).toBe(20);

    await repairNegativePointsCorruption(HOUSEHOLD_ID, habits);

    const hh = capturedUpdates.find(u => u.ref.__path === householdPath);
    expect(hh!.data['points.daily']).toBe(20);
    expect(hh!.data['points.weekly']).toBe(20);
  });

  it("corrects an assigned chore's points on the member doc, not the household pool", async () => {
    getDocsMock.mockResolvedValue(submissionsSnap([{ pointsEarned: 5 }]));
    const habits = [createHabit({ hasSubmissionTracking: true, assignedTo: 'kid_leo' })];

    await repairNegativePointsCorruption(HOUSEHOLD_ID, habits);

    const memberUpd = capturedUpdates.find(
      u => u.ref.__path === `${householdPath}/members/kid_leo`
    );
    expect(memberUpd).toBeDefined();
    expect(memberUpd!.data['points.total']).toEqual({ __increment: -10 });

    const hh = capturedUpdates.find(u => u.ref.__path === householdPath);
    // The household doc still gets its recompute + marker, but no total nudge.
    expect(hh!.data['points.total']).toBeUndefined();
  });
});
