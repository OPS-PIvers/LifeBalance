/**
 * Unit tests for firestoreConverters.ts
 *
 * Per converter, tests cover:
 *   (a) well-formed doc round-trips unchanged (fromFirestore yields expected typed object with
 *       id injected; toFirestore strips id)
 *   (b) partial/legacy doc deserializes without throwing and applies only the intended defaults
 *
 * A minimal fake QueryDocumentSnapshot is used — no Firebase SDK calls are made.
 */

import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  accountConverter,
  budgetBucketConverter,
  bucketPeriodSnapshotConverter,
  calendarItemConverter,
  habitConverter,
  habitSubmissionConverter,
  challengeConverter,
  yearlyGoalConverter,
  rewardItemConverter,
  householdMemberConverter,
  mealConverter,
  shoppingItemConverter,
  groceryCatalogItemConverter,
  mealPlanItemConverter,
  pendingItemConverter,
  householdApiKeyConverter,
  insightConverter,
  weeklyRecapConverter,
  activityLogConverter,
  monthlyMoneyRecapConverter,
  notificationLogConverter,
  netWorthSnapshotConverter,
  transactionConverter,
  transactionCommentConverter,
  todoConverter,
  savingsGoalConverter,
} from './firestoreConverters';

/** Minimal fake QueryDocumentSnapshot for converter tests. */
function fakeSnap(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  } as unknown as Parameters<typeof accountConverter.fromFirestore>[0];
}

/**
 * Call toFirestore bypassing the WithFieldValue<T> constraint.
 * In tests we construct plain objects; the constraint exists to support
 * FieldValue sentinels in production writes which don't apply here.
 */
function callToFirestore<T>(converter: { toFirestore: (v: never) => Record<string, unknown> }, obj: T): Record<string, unknown> {
  return converter.toFirestore(obj as never);
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
describe('accountConverter', () => {
  const wellFormed = {
    name: 'Checking',
    type: 'checking',
    balance: 1000,
    lastUpdated: '2024-01-15T10:00:00.000Z',
  };

  it('(a) well-formed doc: fromFirestore injects id and preserves fields', () => {
    const result = accountConverter.fromFirestore(fakeSnap('acc-1', wellFormed));
    expect(result.id).toBe('acc-1');
    expect(result.name).toBe('Checking');
    expect(result.balance).toBe(1000);
    expect(result.lastUpdated).toBe('2024-01-15T10:00:00.000Z');
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const account = { ...wellFormed, id: 'acc-1' };
    const out = callToFirestore(accountConverter, account);
    expect('id' in out).toBe(false);
    expect(out['name']).toBe('Checking');
  });

  it('(a) Timestamp lastUpdated is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-03-01T12:00:00.000Z'));
    const result = accountConverter.fromFirestore(fakeSnap('acc-2', { ...wellFormed, lastUpdated: ts }));
    expect(result.lastUpdated).toBe('2024-03-01T12:00:00.000Z');
  });

  it('(b) partial doc with missing optional fields does not throw', () => {
    const partial = { name: 'Savings', type: 'savings', balance: 500, lastUpdated: '2024-01-01' };
    expect(() => accountConverter.fromFirestore(fakeSnap('acc-3', partial))).not.toThrow();
    const result = accountConverter.fromFirestore(fakeSnap('acc-3', partial));
    expect(result.id).toBe('acc-3');
    expect(result.cardLast4s).toBeUndefined();
    expect(result.accountLast4).toBeUndefined();
  });

  it('(a) carries accountLast4 / cardLast4s through fromFirestore and toFirestore', () => {
    const withNewFields = { ...wellFormed, accountLast4: '5581', cardLast4s: ['1111', '2222'] };
    const result = accountConverter.fromFirestore(fakeSnap('acc-4', withNewFields));
    expect(result.accountLast4).toBe('5581');
    expect(result.cardLast4s).toEqual(['1111', '2222']);
    const out = callToFirestore(accountConverter, { ...withNewFields, id: 'acc-4' });
    expect(out['accountLast4']).toBe('5581');
    expect(out['cardLast4s']).toEqual(['1111', '2222']);
  });
});

// ---------------------------------------------------------------------------
// BudgetBucket — drops deprecated `spent` field
// ---------------------------------------------------------------------------
describe('budgetBucketConverter', () => {
  const wellFormed = {
    name: 'Groceries',
    limit: 500,
    color: '#green',
    isVariable: true,
    isCore: false,
  };

  it('(a) well-formed doc: fromFirestore injects id', () => {
    const result = budgetBucketConverter.fromFirestore(fakeSnap('bucket-1', wellFormed));
    expect(result.id).toBe('bucket-1');
    expect(result.name).toBe('Groceries');
    expect(result.limit).toBe(500);
  });

  it('(a) well-formed doc: toFirestore strips id and spent', () => {
    const bucket = { ...wellFormed, id: 'bucket-1', spent: 100 };
    const out = callToFirestore(budgetBucketConverter, bucket);
    expect('id' in out).toBe(false);
    expect('spent' in out).toBe(false);
    expect(out['name']).toBe('Groceries');
  });

  it('(b) legacy doc with `spent` field: fromFirestore drops it', () => {
    const legacy = { ...wellFormed, spent: 75 };
    const result = budgetBucketConverter.fromFirestore(fakeSnap('bucket-2', legacy));
    expect('spent' in result).toBe(false);
    expect(result.id).toBe('bucket-2');
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { name: 'Utilities', limit: 200, color: '#blue', isVariable: false, isCore: true };
    expect(() => budgetBucketConverter.fromFirestore(fakeSnap('bucket-3', partial))).not.toThrow();
  });

  it('(b) legacy raw-class color is normalized to its semantic key on read', () => {
    const legacy = { ...wellFormed, color: 'bg-blue-500' };
    const result = budgetBucketConverter.fromFirestore(fakeSnap('bucket-color', legacy));
    expect(result.color).toBe('blue');
  });

  it('(b) unrecognized color falls back to the default key on read', () => {
    // wellFormed.color is '#green' — neither a key nor a bg-* class.
    const result = budgetBucketConverter.fromFirestore(fakeSnap('bucket-default', wellFormed));
    expect(result.color).toBe('emerald');
  });
});

// ---------------------------------------------------------------------------
// BucketPeriodSnapshot
// ---------------------------------------------------------------------------
describe('bucketPeriodSnapshotConverter', () => {
  const wellFormed = {
    bucketId: 'b1',
    bucketName: 'Groceries',
    periodId: '2024-01-01',
    periodStartDate: '2024-01-01',
    periodEndDate: '2024-01-14',
    limit: 500,
    totalSpent: 300,
    totalPending: 50,
    transactionCount: 5,
    createdAt: '2024-01-14T23:59:59Z',
  };

  it('(a) well-formed doc: fromFirestore injects id', () => {
    const result = bucketPeriodSnapshotConverter.fromFirestore(fakeSnap('snap-1', wellFormed));
    expect(result.id).toBe('snap-1');
    expect(result.bucketId).toBe('b1');
    expect(result.totalSpent).toBe(300);
  });

  it('(a) toFirestore strips id', () => {
    const snap = { ...wellFormed, id: 'snap-1' };
    const out = callToFirestore(bucketPeriodSnapshotConverter, snap);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc does not throw', () => {
    const partial = { bucketId: 'b1', bucketName: 'Gas', periodId: '2024-01-01', periodStartDate: '2024-01-01', periodEndDate: '2024-01-14', limit: 100, totalSpent: 0, totalPending: 0, transactionCount: 0, createdAt: '2024-01-01' };
    expect(() => bucketPeriodSnapshotConverter.fromFirestore(fakeSnap('snap-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CalendarItem
// ---------------------------------------------------------------------------
describe('calendarItemConverter', () => {
  const wellFormed = {
    title: 'Rent',
    amount: 1500,
    date: '2024-01-01',
    type: 'expense',
    isPaid: false,
  };

  it('(a) fromFirestore injects id', () => {
    const result = calendarItemConverter.fromFirestore(fakeSnap('cal-1', wellFormed));
    expect(result.id).toBe('cal-1');
    expect(result.title).toBe('Rent');
  });

  it('(a) toFirestore strips id', () => {
    const item = { ...wellFormed, id: 'cal-1' };
    const out = callToFirestore(calendarItemConverter, item);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { title: 'Paycheck', amount: 2000, date: '2024-01-15', type: 'income', isPaid: true };
    expect(() => calendarItemConverter.fromFirestore(fakeSnap('cal-2', partial))).not.toThrow();
    const result = calendarItemConverter.fromFirestore(fakeSnap('cal-2', partial));
    expect(result.bankDescriptorAliases).toBeUndefined();
  });

  it('(a) carries bankDescriptorAliases through fromFirestore and toFirestore', () => {
    const withAliases = { ...wellFormed, bankDescriptorAliases: ['XCEL ENERGY WEB PYMT'] };
    const result = calendarItemConverter.fromFirestore(fakeSnap('cal-5', withAliases));
    expect(result.bankDescriptorAliases).toEqual(['XCEL ENERGY WEB PYMT']);
    const out = callToFirestore(calendarItemConverter, { ...withAliases, id: 'cal-5' });
    expect(out['bankDescriptorAliases']).toEqual(['XCEL ENERGY WEB PYMT']);
  });

  it('(b) legacy Timestamp date is converted to a local yyyy-MM-dd string', () => {
    // Simulate a Firestore Timestamp stored at midnight UTC on 2024-06-15.
    const ts = Timestamp.fromDate(new Date('2024-06-15T00:00:00.000Z'));
    const result = calendarItemConverter.fromFirestore(fakeSnap('cal-3', { ...wellFormed, date: ts }));
    // format() uses local time, but in test environments (UTC) this is still 2024-06-15.
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Must be a plain string, not a Timestamp object.
    expect(typeof result.date).toBe('string');
  });

  it('(b) string date is returned unchanged', () => {
    const result = calendarItemConverter.fromFirestore(fakeSnap('cal-4', { ...wellFormed, date: '2024-03-20' }));
    expect(result.date).toBe('2024-03-20');
  });
});

// ---------------------------------------------------------------------------
// Habit — scoringType defaults to 'threshold', Timestamp lastUpdated normalised
// ---------------------------------------------------------------------------
describe('habitConverter', () => {
  const wellFormed = {
    title: 'Exercise',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2024-01-15T10:00:00.000Z',
  };

  it('(a) fromFirestore injects id and preserves scoringType', () => {
    const result = habitConverter.fromFirestore(fakeSnap('habit-1', wellFormed));
    expect(result.id).toBe('habit-1');
    expect(result.scoringType).toBe('incremental');
    expect(result.title).toBe('Exercise');
  });

  it('(a) toFirestore strips id', () => {
    const habit = { ...wellFormed, id: 'habit-1' };
    const out = callToFirestore(habitConverter, habit);
    expect('id' in out).toBe(false);
  });

  it('(a) Timestamp lastUpdated is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-02-01T08:00:00.000Z'));
    const result = habitConverter.fromFirestore(fakeSnap('habit-2', { ...wellFormed, lastUpdated: ts }));
    expect(result.lastUpdated).toBe('2024-02-01T08:00:00.000Z');
  });

  it('(b) missing scoringType defaults to "threshold"', () => {
    const { scoringType: _dropped, ...partial } = wellFormed;
    const result = habitConverter.fromFirestore(fakeSnap('habit-3', partial));
    expect(result.scoringType).toBe('threshold');
  });

  it('(b) partial doc does not throw', () => {
    const partial = { title: 'Read', category: 'Learning', type: 'positive', basePoints: 5, period: 'daily', targetCount: 1, count: 0, totalCount: 0, completedDates: [], streakDays: 0, lastUpdated: '2024-01-01' };
    expect(() => habitConverter.fromFirestore(fakeSnap('habit-4', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// HabitSubmission
// ---------------------------------------------------------------------------
describe('habitSubmissionConverter', () => {
  const wellFormed = {
    habitId: 'h1',
    habitTitle: 'Exercise',
    timestamp: '2024-01-15T10:00:00.000Z',
    date: '2024-01-15',
    count: 1,
    pointsEarned: 10,
    streakDaysAtTime: 3,
    multiplierApplied: 1.5,
    createdBy: 'user-1',
    createdAt: '2024-01-15T10:00:00.000Z',
  };

  it('(a) fromFirestore injects id', () => {
    const result = habitSubmissionConverter.fromFirestore(fakeSnap('sub-1', wellFormed));
    expect(result.id).toBe('sub-1');
    expect(result.habitId).toBe('h1');
    expect(result.pointsEarned).toBe(10);
  });

  it('(a) toFirestore strips id', () => {
    const sub = { ...wellFormed, id: 'sub-1' };
    const out = callToFirestore(habitSubmissionConverter, sub);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { habitId: 'h2', habitTitle: 'Read', timestamp: '2024-01-01T00:00:00Z', date: '2024-01-01', count: 1, pointsEarned: 5, streakDaysAtTime: 1, multiplierApplied: 1, createdBy: 'u1', createdAt: '2024-01-01T00:00:00Z' };
    expect(() => habitSubmissionConverter.fromFirestore(fakeSnap('sub-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Challenge
// ---------------------------------------------------------------------------
describe('challengeConverter', () => {
  const wellFormed = {
    month: '2024-01',
    title: 'Exercise Challenge',
    relatedHabitIds: ['h1'],
    yearlyRewardLabel: 'Vacation',
    status: 'active',
  };

  it('(a) fromFirestore injects id', () => {
    const result = challengeConverter.fromFirestore(fakeSnap('ch-1', wellFormed));
    expect(result.id).toBe('ch-1');
    expect(result.title).toBe('Exercise Challenge');
  });

  it('(a) toFirestore strips id', () => {
    const challenge = { ...wellFormed, id: 'ch-1' };
    const out = callToFirestore(challengeConverter, challenge);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { month: '2024-02', title: 'Read', relatedHabitIds: [], yearlyRewardLabel: '', status: 'failed' };
    expect(() => challengeConverter.fromFirestore(fakeSnap('ch-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// YearlyGoal
// ---------------------------------------------------------------------------
describe('yearlyGoalConverter', () => {
  const wellFormed = {
    year: 2024,
    title: 'Family Trip',
    requiredMonths: 10,
    successfulMonths: ['2024-01', '2024-02'],
    status: 'in_progress',
    createdBy: 'user-1',
    createdAt: '2024-01-01T00:00:00Z',
  };

  it('(a) fromFirestore injects id', () => {
    const result = yearlyGoalConverter.fromFirestore(fakeSnap('yg-1', wellFormed));
    expect(result.id).toBe('yg-1');
    expect(result.year).toBe(2024);
  });

  it('(a) toFirestore strips id', () => {
    const goal = { ...wellFormed, id: 'yg-1' };
    const out = callToFirestore(yearlyGoalConverter, goal);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { year: 2025, title: 'New Goal', requiredMonths: 6, successfulMonths: [], status: 'in_progress', createdBy: 'u1', createdAt: '2025-01-01' };
    expect(() => yearlyGoalConverter.fromFirestore(fakeSnap('yg-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// RewardItem
// ---------------------------------------------------------------------------
describe('rewardItemConverter', () => {
  const wellFormed = {
    title: 'Movie Night',
    cost: 100,
    icon: 'film',
    createdBy: 'user-1',
  };

  it('(a) fromFirestore injects id', () => {
    const result = rewardItemConverter.fromFirestore(fakeSnap('rw-1', wellFormed));
    expect(result.id).toBe('rw-1');
    expect(result.title).toBe('Movie Night');
  });

  it('(a) toFirestore strips id', () => {
    const reward = { ...wellFormed, id: 'rw-1' };
    const out = callToFirestore(rewardItemConverter, reward);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc does not throw', () => {
    const partial = { title: 'Game', cost: 50, icon: 'gamepad', createdBy: 'u2' };
    expect(() => rewardItemConverter.fromFirestore(fakeSnap('rw-2', partial))).not.toThrow();
  });

  it('(c) Plan 080d optional fields pass through fromFirestore', () => {
    const withKidFields = {
      title: '$5 Allowance',
      cost: 100,
      icon: 'piggy-bank',
      createdBy: 'user-1',
      type: 'allowance',
      allowanceCents: 500,
      targetMemberId: 'kid_leo',
      active: false,
    };
    const result = rewardItemConverter.fromFirestore(fakeSnap('rw-3', withKidFields));
    expect(result.type).toBe('allowance');
    expect(result.allowanceCents).toBe(500);
    expect(result.targetMemberId).toBe('kid_leo');
    expect(result.active).toBe(false);
  });

  it('(c) Plan 080d optional fields survive toFirestore (only id stripped)', () => {
    const reward = {
      id: 'rw-3',
      title: '$5 Allowance',
      cost: 100,
      icon: 'piggy-bank',
      createdBy: 'user-1',
      type: 'allowance' as const,
      allowanceCents: 500,
      targetMemberId: 'kid_leo',
      active: true,
    };
    const out = callToFirestore(rewardItemConverter, reward);
    expect('id' in out).toBe(false);
    expect(out['type']).toBe('allowance');
    expect(out['allowanceCents']).toBe(500);
    expect(out['targetMemberId']).toBe('kid_leo');
    expect(out['active']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HouseholdMember — uses `uid` instead of `id`
// ---------------------------------------------------------------------------
describe('householdMemberConverter', () => {
  const wellFormed = {
    displayName: 'Alice',
    email: 'alice@example.com',
    role: 'admin',
    points: { daily: 10, weekly: 50, total: 200 },
  };

  it('(a) fromFirestore injects uid (not id)', () => {
    const result = householdMemberConverter.fromFirestore(fakeSnap('user-alice', wellFormed));
    expect(result.uid).toBe('user-alice');
    expect('id' in result).toBe(false);
    expect(result.displayName).toBe('Alice');
  });

  it('(a) toFirestore strips uid', () => {
    const member = { ...wellFormed, uid: 'user-alice' };
    const out = callToFirestore(householdMemberConverter, member);
    expect('uid' in out).toBe(false);
    expect(out['displayName']).toBe('Alice');
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { displayName: 'Bob', role: 'member', points: { daily: 0, weekly: 0, total: 0 } };
    expect(() => householdMemberConverter.fromFirestore(fakeSnap('user-bob', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Meal
// ---------------------------------------------------------------------------
describe('mealConverter', () => {
  const wellFormed = {
    name: 'Pasta Carbonara',
    ingredients: [{ name: 'Pasta', quantity: '200g' }],
    tags: ['quick', 'cheap'],
  };

  it('(a) fromFirestore injects id', () => {
    const result = mealConverter.fromFirestore(fakeSnap('meal-1', wellFormed));
    expect(result.id).toBe('meal-1');
    expect(result.name).toBe('Pasta Carbonara');
  });

  it('(a) toFirestore strips id', () => {
    const meal = { ...wellFormed, id: 'meal-1' };
    const out = callToFirestore(mealConverter, meal);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { name: 'Soup', ingredients: [], tags: [] };
    expect(() => mealConverter.fromFirestore(fakeSnap('meal-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ShoppingItem
// ---------------------------------------------------------------------------
describe('shoppingItemConverter', () => {
  const wellFormed = {
    name: 'Milk',
    category: 'Dairy',
    isPurchased: false,
  };

  it('(a) fromFirestore injects id', () => {
    const result = shoppingItemConverter.fromFirestore(fakeSnap('si-1', wellFormed));
    expect(result.id).toBe('si-1');
    expect(result.name).toBe('Milk');
  });

  it('(a) toFirestore strips id', () => {
    const item = { ...wellFormed, id: 'si-1' };
    const out = callToFirestore(shoppingItemConverter, item);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc does not throw', () => {
    const partial = { name: 'Eggs', category: 'Dairy', isPurchased: true };
    expect(() => shoppingItemConverter.fromFirestore(fakeSnap('si-2', partial))).not.toThrow();
  });

  it('(a) needsReview round-trips through both directions', () => {
    const fromDb = shoppingItemConverter.fromFirestore(fakeSnap('si-3', { ...wellFormed, needsReview: true }));
    expect(fromDb.needsReview).toBe(true);
    const out = callToFirestore(shoppingItemConverter, { ...wellFormed, id: 'si-3', needsReview: true });
    expect(out['needsReview']).toBe(true);
  });

  it('(b) needsReview stays undefined when absent (legacy/normal docs)', () => {
    const result = shoppingItemConverter.fromFirestore(fakeSnap('si-4', wellFormed));
    expect(result.needsReview).toBeUndefined();
  });

  it('(a) source round-trips through both directions', () => {
    const fromDb = shoppingItemConverter.fromFirestore(fakeSnap('si-5', { ...wellFormed, source: 'shortcut' }));
    expect(fromDb.source).toBe('shortcut');
    const out = callToFirestore(shoppingItemConverter, { ...wellFormed, id: 'si-5', source: 'shortcut' });
    expect(out['source']).toBe('shortcut');
  });

  it('(b) source stays undefined when absent (legacy/manual docs)', () => {
    const result = shoppingItemConverter.fromFirestore(fakeSnap('si-6', wellFormed));
    expect(result.source).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GroceryCatalogItem
// ---------------------------------------------------------------------------
describe('groceryCatalogItemConverter', () => {
  const wellFormed = {
    name: 'Organic Milk',
    category: 'Dairy',
    purchaseCount: 5,
  };

  it('(a) fromFirestore injects id', () => {
    const result = groceryCatalogItemConverter.fromFirestore(fakeSnap('gc-1', wellFormed));
    expect(result.id).toBe('gc-1');
    expect(result.name).toBe('Organic Milk');
    expect(result.purchaseCount).toBe(5);
  });

  it('(a) toFirestore strips id', () => {
    const item = { ...wellFormed, id: 'gc-1' };
    const out = callToFirestore(groceryCatalogItemConverter, item);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc does not throw', () => {
    const partial = { name: 'Cheese', category: 'Dairy', purchaseCount: 0 };
    expect(() => groceryCatalogItemConverter.fromFirestore(fakeSnap('gc-2', partial))).not.toThrow();
  });

  it('(b) legacy doc missing purchaseCount defaults to 0', () => {
    const legacy = { name: 'Butter', category: 'Dairy' };
    const result = groceryCatalogItemConverter.fromFirestore(fakeSnap('gc-3', legacy));
    expect(result.purchaseCount).toBe(0);
  });

  it('(b) purchaseCount default never overrides a stored value', () => {
    const result = groceryCatalogItemConverter.fromFirestore(fakeSnap('gc-4', wellFormed));
    expect(result.purchaseCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// MealPlanItem
// ---------------------------------------------------------------------------
describe('mealPlanItemConverter', () => {
  const wellFormed = {
    date: '2024-01-15',
    mealName: 'Pasta',
    type: 'dinner',
    isCooked: false,
  };

  it('(a) fromFirestore injects id', () => {
    const result = mealPlanItemConverter.fromFirestore(fakeSnap('mp-1', wellFormed));
    expect(result.id).toBe('mp-1');
    expect(result.date).toBe('2024-01-15');
  });

  it('(a) toFirestore strips id', () => {
    const item = { ...wellFormed, id: 'mp-1' };
    const out = callToFirestore(mealPlanItemConverter, item);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc does not throw', () => {
    const partial = { date: '2024-01-16', mealName: 'Salad', type: 'lunch', isCooked: true };
    expect(() => mealPlanItemConverter.fromFirestore(fakeSnap('mp-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PendingItem
// ---------------------------------------------------------------------------
describe('pendingItemConverter', () => {
  const wellFormed = {
    text: 'Buy milk',
    source: 'shortcut',
    createdAt: '2024-01-15T10:00:00Z',
    processed: false,
  };

  it('(a) fromFirestore injects id', () => {
    const result = pendingItemConverter.fromFirestore(fakeSnap('pi-1', wellFormed));
    expect(result.id).toBe('pi-1');
    expect(result.text).toBe('Buy milk');
    expect(result.processed).toBe(false);
  });

  it('(a) toFirestore strips id', () => {
    const item = { ...wellFormed, id: 'pi-1' };
    const out = callToFirestore(pendingItemConverter, item);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { text: 'Add eggs to shopping list', source: 'shortcut', createdAt: '2024-01-01', processed: true };
    expect(() => pendingItemConverter.fromFirestore(fakeSnap('pi-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// HouseholdApiKey — Timestamp normalisation for createdAt/lastUsedAt
// ---------------------------------------------------------------------------
describe('householdApiKeyConverter', () => {
  const wellFormed = {
    hashedKey: 'sha256hash',
    keyPrefix: 'lb_abc123',
    name: 'iPhone Shortcut',
    createdAt: '2024-01-01T00:00:00Z',
    createdBy: 'user-1',
    usageCount: 10,
    status: 'active',
    permissions: { habits: true, expenses: true, shoppingList: true, receiptScanning: false },
  };

  it('(a) fromFirestore injects id', () => {
    const result = householdApiKeyConverter.fromFirestore(fakeSnap('ak-1', wellFormed));
    expect(result.id).toBe('ak-1');
    expect(result.name).toBe('iPhone Shortcut');
  });

  it('(a) toFirestore strips id', () => {
    const key = { ...wellFormed, id: 'ak-1' };
    const out = callToFirestore(householdApiKeyConverter, key);
    expect('id' in out).toBe(false);
  });

  it('(a) Timestamp createdAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-06-01T12:00:00.000Z'));
    const result = householdApiKeyConverter.fromFirestore(fakeSnap('ak-2', { ...wellFormed, createdAt: ts }));
    expect(result.createdAt).toBe('2024-06-01T12:00:00.000Z');
  });

  it('(a) Timestamp lastUsedAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-06-15T08:30:00.000Z'));
    const result = householdApiKeyConverter.fromFirestore(fakeSnap('ak-3', { ...wellFormed, lastUsedAt: ts }));
    expect(result.lastUsedAt).toBe('2024-06-15T08:30:00.000Z');
  });

  it('(b) partial doc without lastUsedAt does not throw', () => {
    const partial = { hashedKey: 'h', keyPrefix: 'lb_x', name: 'Test', createdAt: '2024-01-01', createdBy: 'u1', usageCount: 0, status: 'active', permissions: { habits: false, expenses: false, shoppingList: false, receiptScanning: false } };
    expect(() => householdApiKeyConverter.fromFirestore(fakeSnap('ak-4', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Insight
// ---------------------------------------------------------------------------
describe('insightConverter', () => {
  const wellFormed = {
    text: 'You spent 20% less on groceries this week.',
    generatedAt: '2024-01-15T09:00:00Z',
    type: 'spending',
  };

  it('(a) fromFirestore injects id', () => {
    const result = insightConverter.fromFirestore(fakeSnap('ins-1', wellFormed));
    expect(result.id).toBe('ins-1');
    expect(result.text).toBe('You spent 20% less on groceries this week.');
  });

  it('(a) toFirestore strips id', () => {
    const insight = { ...wellFormed, id: 'ins-1' };
    const out = callToFirestore(insightConverter, insight);
    expect('id' in out).toBe(false);
  });

  it('(b) partial doc without optional actions does not throw', () => {
    const partial = { text: 'Great job!', generatedAt: '2024-01-01', type: 'general' };
    expect(() => insightConverter.fromFirestore(fakeSnap('ins-2', partial))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WeeklyRecap — Timestamp normalisation for generatedAt
// ---------------------------------------------------------------------------
describe('weeklyRecapConverter', () => {
  const wellFormed = {
    isoWeek: '2026-W27',
    generatedAt: '2026-07-05T22:00:00.000Z',
    totalSpend: 412.5,
    priorWeekSpend: 468.13,
    topCategoryDeltas: [{ category: 'Groceries', current: 180, prior: 220 }],
    habitCompletions: 12,
    streaksAtRisk: [{ habitTitle: 'Read 30 mins', streakDays: 9 }],
    pointsByMember: [{ memberId: 'user-1', name: 'Test User', points: 85 }],
    upcomingBills: [{ title: 'Rent', amount: 1200, date: '2026-07-08' }],
    narrative: 'A calm spending week — nice work.',
    narrativeSource: 'ai',
    premium: true,
  };

  it('(a) well-formed doc: fromFirestore injects id (the ISO week) and preserves fields', () => {
    const result = weeklyRecapConverter.fromFirestore(fakeSnap('2026-W27', wellFormed));
    expect(result.id).toBe('2026-W27');
    expect(result.isoWeek).toBe('2026-W27');
    expect(result.totalSpend).toBe(412.5);
    expect(result.narrativeSource).toBe('ai');
    expect(result.topCategoryDeltas).toEqual([{ category: 'Groceries', current: 180, prior: 220 }]);
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const recap = { ...wellFormed, id: '2026-W27' };
    const out = callToFirestore(weeklyRecapConverter, recap);
    expect('id' in out).toBe(false);
    expect(out['isoWeek']).toBe('2026-W27');
  });

  it('(a) Timestamp generatedAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2026-07-05T22:00:00.000Z'));
    const result = weeklyRecapConverter.fromFirestore(
      fakeSnap('2026-W27', { ...wellFormed, generatedAt: ts })
    );
    expect(result.generatedAt).toBe('2026-07-05T22:00:00.000Z');
  });

  it('(b) partial doc with missing sections does not throw', () => {
    const partial = {
      isoWeek: '2026-W26',
      generatedAt: '2026-06-28T22:00:00.000Z',
      totalSpend: 0,
      priorWeekSpend: 0,
      narrative: '',
      narrativeSource: 'template',
      premium: false,
    };
    expect(() => weeklyRecapConverter.fromFirestore(fakeSnap('2026-W26', partial))).not.toThrow();
    const result = weeklyRecapConverter.fromFirestore(fakeSnap('2026-W26', partial));
    expect(result.id).toBe('2026-W26');
    expect(result.premium).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ActivityLogEntry — id injection + Timestamp normalisation (F-XCUT-01)
// ---------------------------------------------------------------------------
describe('activityLogConverter', () => {
  const wellFormed = {
    actorUid: 'u1',
    actorName: 'Paul',
    domain: 'money',
    action: 'bill_paid',
    summary: 'Paul paid Electric Bill ($142)',
    timestamp: '2026-07-14T12:00:00.000Z',
  };

  it('(a) well-formed doc: fromFirestore injects the auto-id and preserves fields', () => {
    const result = activityLogConverter.fromFirestore(fakeSnap('act_123', wellFormed));
    expect(result.id).toBe('act_123');
    expect(result.actorName).toBe('Paul');
    expect(result.domain).toBe('money');
    expect(result.summary).toBe('Paul paid Electric Bill ($142)');
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const out = callToFirestore(activityLogConverter, { ...wellFormed, id: 'act_123' });
    expect('id' in out).toBe(false);
    expect(out['action']).toBe('bill_paid');
  });

  it('(a) Timestamp timestamp is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2026-07-14T12:00:00.000Z'));
    const result = activityLogConverter.fromFirestore(
      fakeSnap('act_123', { ...wellFormed, timestamp: ts })
    );
    expect(result.timestamp).toBe('2026-07-14T12:00:00.000Z');
  });

  it('(b) partial doc does not throw', () => {
    const partial = { actorUid: 'u2', domain: 'habit', action: 'habit_completed' };
    expect(() => activityLogConverter.fromFirestore(fakeSnap('act_9', partial))).not.toThrow();
    expect(activityLogConverter.fromFirestore(fakeSnap('act_9', partial)).id).toBe('act_9');
  });
});

// ---------------------------------------------------------------------------
// MonthlyMoneyRecap — Timestamp normalisation for generatedAt (F-MONEY-06)
// ---------------------------------------------------------------------------
describe('monthlyMoneyRecapConverter', () => {
  const wellFormed = {
    month: '2026-06',
    generatedAt: '2026-07-01T13:00:00.000Z',
    totalIncome: 5200,
    totalSpend: 3480.25,
    priorMonthSpend: 3120.5,
    bucketResults: [
      { bucketId: 'b1', bucketName: 'Groceries', limit: 600, spent: 645.1, overUnder: 45.1 },
    ],
    topExpense: { merchant: 'Costco', amount: 312.4, category: 'Groceries', date: '2026-06-14' },
    netWorthDelta: null,
    narrative: 'A steady month — groceries ran a touch over.',
    narrativeSource: 'ai',
    premium: true,
  };

  it('(a) well-formed doc: fromFirestore injects id (the month) and preserves fields', () => {
    const result = monthlyMoneyRecapConverter.fromFirestore(fakeSnap('2026-06', wellFormed));
    expect(result.id).toBe('2026-06');
    expect(result.month).toBe('2026-06');
    expect(result.totalSpend).toBe(3480.25);
    expect(result.bucketResults[0]?.overUnder).toBe(45.1);
    expect(result.topExpense?.merchant).toBe('Costco');
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const recap = { ...wellFormed, id: '2026-06' };
    const out = callToFirestore(monthlyMoneyRecapConverter, recap);
    expect('id' in out).toBe(false);
    expect(out['month']).toBe('2026-06');
  });

  it('(a) Timestamp generatedAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2026-07-01T13:00:00.000Z'));
    const result = monthlyMoneyRecapConverter.fromFirestore(
      fakeSnap('2026-06', { ...wellFormed, generatedAt: ts })
    );
    expect(result.generatedAt).toBe('2026-07-01T13:00:00.000Z');
  });

  it('(b) partial doc with missing sections does not throw', () => {
    const partial = {
      month: '2026-05',
      generatedAt: '2026-06-01T13:00:00.000Z',
      totalIncome: 0,
      totalSpend: 0,
      priorMonthSpend: 0,
      bucketResults: [],
      topExpense: null,
      netWorthDelta: null,
      narrative: '',
      narrativeSource: 'template',
      premium: false,
    };
    expect(() => monthlyMoneyRecapConverter.fromFirestore(fakeSnap('2026-05', partial))).not.toThrow();
    const result = monthlyMoneyRecapConverter.fromFirestore(fakeSnap('2026-05', partial));
    expect(result.id).toBe('2026-05');
    expect(result.premium).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NotificationLogEntry (F-NOTIF-02) — Timestamp normalisation for createdAt,
// readBy defensively coerced to an array.
// ---------------------------------------------------------------------------
describe('notificationLogConverter', () => {
  const wellFormed = {
    type: 'bill_reminder',
    recipientUid: 'user-1',
    title: 'Bills due in 3 days',
    body: '2 bills totaling $180.00 coming up',
    data: { url: '/budget' },
    createdAt: '2026-07-10T13:00:00.000Z',
    readBy: [],
  };

  it('(a) well-formed doc: fromFirestore injects id and preserves fields', () => {
    const result = notificationLogConverter.fromFirestore(fakeSnap('log-1', wellFormed));
    expect(result.id).toBe('log-1');
    expect(result.type).toBe('bill_reminder');
    expect(result.recipientUid).toBe('user-1');
    expect(result.readBy).toEqual([]);
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const entry = { ...wellFormed, id: 'log-1' };
    const out = callToFirestore(notificationLogConverter, entry);
    expect('id' in out).toBe(false);
    expect(out['title']).toBe('Bills due in 3 days');
  });

  it('(a) Timestamp createdAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2026-07-10T13:00:00.000Z'));
    const result = notificationLogConverter.fromFirestore(
      fakeSnap('log-1', { ...wellFormed, createdAt: ts })
    );
    expect(result.createdAt).toBe('2026-07-10T13:00:00.000Z');
  });

  it('(b) partial/legacy doc with missing readBy does not throw and defaults to []', () => {
    const partial = {
      type: 'streak_warning',
      recipientUid: 'user-2',
      title: "Don't break your streak!",
      body: 'You have 1 habit at risk.',
      createdAt: '2026-07-10T13:00:00.000Z',
    };
    expect(() => notificationLogConverter.fromFirestore(fakeSnap('log-2', partial))).not.toThrow();
    const result = notificationLogConverter.fromFirestore(fakeSnap('log-2', partial));
    expect(result.id).toBe('log-2');
    expect(result.readBy).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// NetWorthSnapshot (F-MONEY-09) — no Timestamp fields; id is the date.
// ---------------------------------------------------------------------------
describe('netWorthSnapshotConverter', () => {
  const wellFormed = {
    date: '2026-07-14',
    totalAssets: 5000,
    totalLiabilities: 1200.5,
    netWorth: 3799.5,
  };

  it('(a) well-formed doc: fromFirestore injects id (the date) and preserves fields', () => {
    const result = netWorthSnapshotConverter.fromFirestore(fakeSnap('2026-07-14', wellFormed));
    expect(result.id).toBe('2026-07-14');
    expect(result.date).toBe('2026-07-14');
    expect(result.totalAssets).toBe(5000);
    expect(result.totalLiabilities).toBe(1200.5);
    expect(result.netWorth).toBe(3799.5);
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const snap = { ...wellFormed, id: '2026-07-14' };
    const out = callToFirestore(netWorthSnapshotConverter, snap);
    expect('id' in out).toBe(false);
    expect(out['date']).toBe('2026-07-14');
  });

  it('(b) partial doc with zeroed totals does not throw', () => {
    const partial = { date: '2026-07-13', totalAssets: 0, totalLiabilities: 0, netWorth: 0 };
    expect(() => netWorthSnapshotConverter.fromFirestore(fakeSnap('2026-07-13', partial))).not.toThrow();
    const result = netWorthSnapshotConverter.fromFirestore(fakeSnap('2026-07-13', partial));
    expect(result.id).toBe('2026-07-13');
    expect(result.netWorth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Transaction — Timestamp normalisation for createdAt
// ---------------------------------------------------------------------------
describe('transactionConverter', () => {
  const wellFormed = {
    amount: 42.50,
    merchant: 'Costco',
    category: 'Groceries',
    date: '2024-01-15',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    createdAt: '2024-01-15T10:00:00.000Z',
  };

  it('(a) fromFirestore injects id and preserves all fields', () => {
    const result = transactionConverter.fromFirestore(fakeSnap('tx-1', wellFormed));
    expect(result.id).toBe('tx-1');
    expect(result.amount).toBe(42.50);
    expect(result.merchant).toBe('Costco');
    expect(result.createdAt).toBe('2024-01-15T10:00:00.000Z');
  });

  it('(a) toFirestore strips id', () => {
    const tx = { ...wellFormed, id: 'tx-1' };
    const out = callToFirestore(transactionConverter, tx);
    expect('id' in out).toBe(false);
    expect(out['merchant']).toBe('Costco');
  });

  it('(a) Timestamp createdAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-03-20T15:45:00.000Z'));
    const result = transactionConverter.fromFirestore(fakeSnap('tx-2', { ...wellFormed, createdAt: ts }));
    expect(result.createdAt).toBe('2024-03-20T15:45:00.000Z');
  });

  it('(b) partial doc without optional createdAt does not throw', () => {
    const { createdAt: _dropped, ...partial } = wellFormed;
    const result = transactionConverter.fromFirestore(fakeSnap('tx-3', partial));
    expect(result.id).toBe('tx-3');
    expect(result.createdAt).toBeUndefined();
  });

  it('Apple Pay $0 stub fields (needsAmount / needsAmountPromptedAt) round-trip', () => {
    const stub = {
      ...wellFormed,
      amount: 0,
      status: 'pending_review',
      needsAmount: true,
      needsAmountPromptedAt: '2024-01-15T11:00:00.000Z',
    };
    // fromFirestore preserves both via the spread
    const read = transactionConverter.fromFirestore(fakeSnap('tx-4', stub));
    expect(read.needsAmount).toBe(true);
    expect(read.needsAmountPromptedAt).toBe('2024-01-15T11:00:00.000Z');
    // toFirestore preserves both while stripping the synthetic id
    const out = callToFirestore(transactionConverter, { ...stub, id: 'tx-4' });
    expect(out['needsAmount']).toBe(true);
    expect(out['needsAmountPromptedAt']).toBe('2024-01-15T11:00:00.000Z');
    expect('id' in out).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TransactionComment (Plan 23)
// ---------------------------------------------------------------------------
describe('transactionCommentConverter', () => {
  const wellFormed = {
    authorUid: 'uid-1',
    text: 'What was this for?',
    createdAt: '2026-07-10T10:00:00.000Z',
  };

  it('(a) fromFirestore injects id and preserves all fields', () => {
    const result = transactionCommentConverter.fromFirestore(fakeSnap('comment-1', wellFormed));
    expect(result.id).toBe('comment-1');
    expect(result.authorUid).toBe('uid-1');
    expect(result.text).toBe('What was this for?');
    expect(result.createdAt).toBe('2026-07-10T10:00:00.000Z');
  });

  it('(a) toFirestore strips id', () => {
    const comment = { ...wellFormed, id: 'comment-1' };
    const out = callToFirestore(transactionCommentConverter, comment);
    expect('id' in out).toBe(false);
    expect(out['text']).toBe('What was this for?');
  });

  it('(b) partial doc missing text does not throw', () => {
    const { text: _dropped, ...partial } = wellFormed;
    const result = transactionCommentConverter.fromFirestore(fakeSnap('comment-2', partial));
    expect(result.id).toBe('comment-2');
    expect(result.text).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ToDo — Timestamp normalisation for createdAt/completedAt
// ---------------------------------------------------------------------------
describe('todoConverter', () => {
  const wellFormed = {
    text: 'Take out trash',
    completeByDate: '2024-01-15',
    assignedTo: 'user-1',
    isCompleted: false,
    createdBy: 'user-1',
    createdAt: '2024-01-14T10:00:00.000Z',
  };

  it('(a) fromFirestore injects id', () => {
    const result = todoConverter.fromFirestore(fakeSnap('todo-1', wellFormed));
    expect(result.id).toBe('todo-1');
    expect(result.text).toBe('Take out trash');
    expect(result.createdAt).toBe('2024-01-14T10:00:00.000Z');
  });

  it('(a) toFirestore strips id', () => {
    const todo = { ...wellFormed, id: 'todo-1' };
    const out = callToFirestore(todoConverter, todo);
    expect('id' in out).toBe(false);
    expect(out['text']).toBe('Take out trash');
  });

  it('(a) Timestamp createdAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2024-04-01T07:00:00.000Z'));
    const result = todoConverter.fromFirestore(fakeSnap('todo-2', { ...wellFormed, createdAt: ts }));
    expect(result.createdAt).toBe('2024-04-01T07:00:00.000Z');
  });

  it('(a) Timestamp completedAt is converted to ISO string when present', () => {
    const ts = Timestamp.fromDate(new Date('2024-04-01T18:00:00.000Z'));
    const result = todoConverter.fromFirestore(fakeSnap('todo-3', { ...wellFormed, isCompleted: true, completedAt: ts }));
    expect(result.completedAt).toBe('2024-04-01T18:00:00.000Z');
  });

  it('(b) completedAt remains undefined when absent', () => {
    const result = todoConverter.fromFirestore(fakeSnap('todo-4', wellFormed));
    expect(result.completedAt).toBeUndefined();
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { text: 'Walk dog', completeByDate: '2024-01-01', assignedTo: 'u1', isCompleted: false, createdBy: 'u1', createdAt: '2024-01-01' };
    expect(() => todoConverter.fromFirestore(fakeSnap('todo-5', partial))).not.toThrow();
  });

  it('(a) isImportant round-trips through both directions', () => {
    const fromDb = todoConverter.fromFirestore(fakeSnap('todo-6', { ...wellFormed, isImportant: true }));
    expect(fromDb.isImportant).toBe(true);
    const out = callToFirestore(todoConverter, { ...wellFormed, id: 'todo-6', isImportant: true });
    expect(out['isImportant']).toBe(true);
  });

  it('(b) isImportant stays undefined when absent (legacy docs)', () => {
    const result = todoConverter.fromFirestore(fakeSnap('todo-7', wellFormed));
    expect(result.isImportant).toBeUndefined();
  });

  it('(a) needsReview round-trips through both directions', () => {
    const fromDb = todoConverter.fromFirestore(fakeSnap('todo-8', { ...wellFormed, needsReview: true }));
    expect(fromDb.needsReview).toBe(true);
    const out = callToFirestore(todoConverter, { ...wellFormed, id: 'todo-8', needsReview: true });
    expect(out['needsReview']).toBe(true);
  });

  it('(b) needsReview stays undefined when absent (legacy/normal docs)', () => {
    const result = todoConverter.fromFirestore(fakeSnap('todo-9', wellFormed));
    expect(result.needsReview).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SavingsGoal (Plan 24) — preserves Timestamp→ISO normalisation for
// createdAt/completedAt.
// ---------------------------------------------------------------------------
describe('savingsGoalConverter', () => {
  const wellFormed = {
    name: 'Christmas',
    targetAmount: 1200,
    savedAmount: 300,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('(a) well-formed doc: fromFirestore injects id and preserves fields', () => {
    const result = savingsGoalConverter.fromFirestore(fakeSnap('goal-1', wellFormed));
    expect(result.id).toBe('goal-1');
    expect(result.name).toBe('Christmas');
    expect(result.targetAmount).toBe(1200);
    expect(result.savedAmount).toBe(300);
  });

  it('(a) well-formed doc: toFirestore strips id', () => {
    const goal = { ...wellFormed, id: 'goal-1' };
    const out = callToFirestore(savingsGoalConverter, goal);
    expect('id' in out).toBe(false);
    expect(out['name']).toBe('Christmas');
  });

  it('(a) Timestamp createdAt is converted to ISO string', () => {
    const ts = Timestamp.fromDate(new Date('2026-02-01T12:00:00.000Z'));
    const result = savingsGoalConverter.fromFirestore(fakeSnap('goal-2', { ...wellFormed, createdAt: ts }));
    expect(result.createdAt).toBe('2026-02-01T12:00:00.000Z');
  });

  it('(a) Timestamp completedAt is converted to ISO string when present', () => {
    const ts = Timestamp.fromDate(new Date('2026-03-01T12:00:00.000Z'));
    const result = savingsGoalConverter.fromFirestore(fakeSnap('goal-3', { ...wellFormed, completedAt: ts }));
    expect(result.completedAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('(b) partial doc without optional fields does not throw', () => {
    const partial = { name: 'Vacation', targetAmount: 500, savedAmount: 0, createdAt: '2026-01-01' };
    expect(() => savingsGoalConverter.fromFirestore(fakeSnap('goal-4', partial))).not.toThrow();
    const result = savingsGoalConverter.fromFirestore(fakeSnap('goal-4', partial));
    expect(result.id).toBe('goal-4');
    expect(result.ownerId).toBeUndefined();
    expect(result.completedAt).toBeUndefined();
  });
});
