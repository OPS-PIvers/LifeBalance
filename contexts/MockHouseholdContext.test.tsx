import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { addDays, startOfWeek, subDays } from 'date-fns';
import { MockHouseholdProvider } from './MockHouseholdContext';
import { useFinance, useGamification, useHousehold } from './FirebaseHouseholdContext';
import { calculateSafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { calculateBucketSpent } from '@/utils/bucketSpentCalculator';
import { DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
import { getLocalDateString } from '@/utils/dateHelpers';
import { decomposeDayPoints } from '@/utils/habitAttribution';
import type { Habit } from '@/types/schema';

// Finding 4.4: MockHouseholdContext must expose a well-formed
// `safeToSpendBreakdown` so the Test Mode finance slice is in parity with the
// real Firebase provider. A consumer reading `useFinance().safeToSpendBreakdown`
// must NOT get `undefined` in Test Mode (which would pass tests where production
// fails).

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MockHouseholdProvider>{children}</MockHouseholdProvider>
);

const captureFinance = () => renderHook(() => useFinance(), { wrapper }).result.current;

describe('MockHouseholdContext finance slice parity', () => {
  it('exposes a defined safeToSpendBreakdown', () => {
    const finance = captureFinance();
    expect(finance.safeToSpendBreakdown).toBeDefined();
  });

  it('exposes a well-formed SafeToSpendBreakdown with all fields', () => {
    const { safeToSpendBreakdown: breakdown } = captureFinance();
    expect(breakdown).toBeDefined();
    if (!breakdown) return; // narrow for TS; assertion above guards the runtime

    expect(typeof breakdown.checkingBalance).toBe('number');
    expect(typeof breakdown.unpaidBills).toBe('number');
    expect(typeof breakdown.pendingSpend).toBe('number');
    expect(typeof breakdown.safeToSpend).toBe('number');
    // nextPaycheckDate is string | null
    expect(
      breakdown.nextPaycheckDate === null || typeof breakdown.nextPaycheckDate === 'string'
    ).toBe(true);
  });

  it('keeps safeToSpend consistent with its breakdown', () => {
    const finance = captureFinance();
    expect(finance.safeToSpend).toBe(finance.safeToSpendBreakdown?.safeToSpend);
  });

  it('computes the breakdown from the mock finance data via the shared calculator', () => {
    const finance = captureFinance();
    // Recompute from the exact mock state exposed on the slice using the same
    // pure calculator; the breakdown must match field-for-field.
    const expected = calculateSafeToSpendBreakdown(
      finance.accounts,
      finance.calendarItems,
      finance.currentPeriodId,
      finance.transactions
    );
    expect(finance.safeToSpendBreakdown).toEqual(expected);
  });

  it('counts only checking accounts toward checkingBalance', () => {
    const { safeToSpendBreakdown: breakdown, accounts } = captureFinance();
    const checkingTotal = accounts
      .filter((a) => a.type === 'checking')
      .reduce((sum, a) => sum + a.balance, 0);
    // Compare in cents to avoid float drift across the assertion.
    expect(Math.round((breakdown?.checkingBalance ?? 0) * 100)).toBe(
      Math.round(checkingTotal * 100)
    );
  });

  it('reports zero pendingSpend when no pending_review transactions exist', () => {
    // Seed transactions are all `verified`, so pending spend should be 0.
    const { safeToSpendBreakdown: breakdown } = captureFinance();
    expect(breakdown?.pendingSpend).toBe(0);
  });
});

// Plan 080c-5: the reviewer flagged that the only coverage of the todo→points
// wiring was the pure dormancy gate (utils/todoPoints.test.ts). This exercises the
// REAL wiring end-to-end through the provider — completeToDo must credit a managed
// kid's points map, AND must NOT credit anything for a non-managed (parent)
// assignee (the dormant path for normal households).
describe('MockHouseholdContext completeToDo → kid point credit', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });

  const kidPoints = (result: ReturnType<typeof captureHousehold>['result']) =>
    result.current.members.find(m => m.uid === 'kid_leo')!.points;

  it('credits the seeded managed kid the todo points on completion (daily/weekly/total)', async () => {
    const { result } = captureHousehold();
    const before = { ...kidPoints(result) };
    // The seeded kid todo (todo_kid_1) is assigned to kid_leo with points: 5.
    expect(result.current.todos.find(t => t.id === 'todo_kid_1')?.points).toBe(5);

    await act(async () => {
      await result.current.completeToDo('todo_kid_1');
    });

    const after = kidPoints(result);
    expect(after.daily).toBe(before.daily + 5);
    expect(after.weekly).toBe(before.weekly + 5);
    expect(after.total).toBe(before.total + 5);
    // The todo is now marked complete.
    expect(result.current.todos.find(t => t.id === 'todo_kid_1')?.isCompleted).toBe(true);
  });

  it('credits DEFAULT_TODO_POINTS to a managed kid when the todo has no explicit points', async () => {
    const { result } = captureHousehold();
    const before = { ...kidPoints(result) };

    await act(async () => {
      await result.current.addToDo({
        text: 'Feed the fox',
        completeByDate: getLocalDateString(),
        assignedTo: 'kid_leo',
        isCompleted: false,
        // no explicit points → should fall back to DEFAULT_TODO_POINTS
      });
    });
    const created = result.current.todos.find(t => t.text === 'Feed the fox');
    expect(created).toBeDefined();

    await act(async () => {
      await result.current.completeToDo(created!.id);
    });

    expect(kidPoints(result).total).toBe(before.total + DEFAULT_TODO_POINTS);
  });

  it('does NOT change any member points when completing a non-managed (parent) assignee todo', async () => {
    const { result } = captureHousehold();
    const before = result.current.members.map(m => ({ uid: m.uid, ...m.points }));

    await act(async () => {
      await result.current.addToDo({
        text: 'Pay the electric bill',
        completeByDate: getLocalDateString(),
        assignedTo: 'test-user-id', // the parent/admin — not a managed kid
        isCompleted: false,
        points: 50,
      });
    });
    const created = result.current.todos.find(t => t.text === 'Pay the electric bill');
    expect(created).toBeDefined();

    await act(async () => {
      await result.current.completeToDo(created!.id);
    });

    const after = result.current.members.map(m => ({ uid: m.uid, ...m.points }));
    expect(after).toEqual(before);
  });

  // Points-integrity fix: restoring a completed kid task must REVERSE the
  // credit through the same dormancy gate (was a plain updateToDo that left
  // the kid over-credited).
  it('uncompleteToDo reverses the kid credit — complete→restore is points-neutral', async () => {
    const { result } = captureHousehold();
    const before = { ...kidPoints(result) };

    await act(async () => {
      await result.current.completeToDo('todo_kid_1'); // +5
    });
    expect(kidPoints(result).total).toBe(before.total + 5);

    await act(async () => {
      await result.current.uncompleteToDo('todo_kid_1'); // -5 (same-day → all three)
    });

    expect(kidPoints(result)).toEqual(before);
    expect(result.current.todos.find(t => t.id === 'todo_kid_1')?.isCompleted).toBe(false);
  });

  it('uncompleteToDo is idempotent — restoring twice never double-reverses', async () => {
    const { result } = captureHousehold();
    const before = { ...kidPoints(result) };

    await act(async () => {
      await result.current.completeToDo('todo_kid_1');
    });
    await act(async () => {
      await result.current.uncompleteToDo('todo_kid_1');
    });
    await act(async () => {
      await result.current.uncompleteToDo('todo_kid_1'); // already active → no-op
    });

    expect(kidPoints(result)).toEqual(before);
  });

  it('uncompleteToDo does NOT change member points for a non-kid assignee', async () => {
    const { result } = captureHousehold();

    await act(async () => {
      await result.current.addToDo({
        text: 'Water the plants',
        completeByDate: getLocalDateString(),
        assignedTo: 'test-user-id',
        isCompleted: false,
        points: 50,
      });
    });
    const created = result.current.todos.find(t => t.text === 'Water the plants')!;
    await act(async () => {
      await result.current.completeToDo(created.id);
    });
    const before = result.current.members.map(m => ({ uid: m.uid, ...m.points }));

    await act(async () => {
      await result.current.uncompleteToDo(created.id);
    });

    expect(result.current.members.map(m => ({ uid: m.uid, ...m.points }))).toEqual(before);
    expect(result.current.todos.find(t => t.id === created.id)?.isCompleted).toBe(false);
  });

  // F-TODO-01 counterpart: completing a recurring to-do spawns the next
  // instance; restoring must reconcile that spawn or the household ends up
  // with two active copies of the same chore.
  it('uncompleteToDo deletes the spawned next instance for a recurring to-do', async () => {
    const { result } = captureHousehold();

    await act(async () => {
      await result.current.addToDo({
        text: 'Take out the trash',
        completeByDate: getLocalDateString(),
        assignedTo: 'test-user-id',
        isCompleted: false,
        recurrence: { frequency: 'weekly' },
      });
    });
    const original = result.current.todos.find(t => t.text === 'Take out the trash')!;

    await act(async () => {
      await result.current.completeToDo(original.id);
    });
    // Completion spawned exactly one active next instance.
    const spawnedBefore = result.current.todos.filter(t => t.text === 'Take out the trash' && !t.isCompleted);
    expect(spawnedBefore).toHaveLength(1);

    await act(async () => {
      await result.current.uncompleteToDo(original.id);
    });

    // The restore reconciled the spawn — only the original (now active
    // again) remains, no orphaned duplicate.
    const activeCopies = result.current.todos.filter(t => t.text === 'Take out the trash' && !t.isCompleted);
    expect(activeCopies).toHaveLength(1);
    expect(activeCopies[0]?.id).toBe(original.id);
  });

  it('uncompleteToDo leaves the recurring spawn untouched if it was already completed', async () => {
    const { result } = captureHousehold();

    await act(async () => {
      await result.current.addToDo({
        text: 'Mow the lawn',
        completeByDate: getLocalDateString(),
        assignedTo: 'test-user-id',
        isCompleted: false,
        recurrence: { frequency: 'weekly' },
      });
    });
    const original = result.current.todos.find(t => t.text === 'Mow the lawn')!;

    await act(async () => {
      await result.current.completeToDo(original.id);
    });
    const spawned = result.current.todos.find(t => t.text === 'Mow the lawn' && !t.isCompleted)!;
    expect(spawned).toBeDefined();

    // The spawn itself gets completed before anyone restores the original.
    await act(async () => {
      await result.current.completeToDo(spawned.id);
    });

    await act(async () => {
      await result.current.uncompleteToDo(original.id);
    });

    // The already-completed spawn is left alone — restoring the original
    // must never delete a chore someone else already finished.
    expect(result.current.todos.find(t => t.id === spawned.id)?.isCompleted).toBe(true);
  });
});

// Plan 080d: the mock rewards store is now stateful (seeded with 2 rewards) and
// exposes addReward/updateReward/deleteReward so the parent management UI is
// walkable in Test Mode. These exercise the REAL mock wiring through the provider.
describe('MockHouseholdContext reward CRUD (Plan 080d)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });

  it('seeds two rewards (one realWorld, one allowance) in the store', () => {
    const { result } = captureHousehold();
    const rewards = result.current.rewardsInventory;
    expect(rewards).toHaveLength(2);
    const allowance = rewards.find(r => r.type === 'allowance');
    expect(allowance).toBeDefined();
    expect(allowance!.allowanceCents).toBe(500);
    expect(rewards.some(r => r.type === 'realWorld')).toBe(true);
  });

  it('addReward appends a reward with a generated id and createdBy', async () => {
    const { result } = captureHousehold();
    const before = result.current.rewardsInventory.length;

    await act(async () => {
      await result.current.addReward({
        title: 'Ice Cream',
        cost: 30,
        icon: '🍦',
        type: 'realWorld',
        active: true,
      });
    });

    const rewards = result.current.rewardsInventory;
    expect(rewards).toHaveLength(before + 1);
    const created = rewards.find(r => r.title === 'Ice Cream');
    expect(created).toBeDefined();
    expect(created!.id).toBeTruthy();
    expect(created!.createdBy).toBe('test-user-id');
  });

  it('updateReward replaces a reward by id', async () => {
    const { result } = captureHousehold();
    const target = result.current.rewardsInventory[0]!;

    await act(async () => {
      await result.current.updateReward({ ...target, title: 'Renamed', cost: 999 });
    });

    const updated = result.current.rewardsInventory.find(r => r.id === target.id);
    expect(updated!.title).toBe('Renamed');
    expect(updated!.cost).toBe(999);
  });

  it('deleteReward removes a reward by id', async () => {
    const { result } = captureHousehold();
    const target = result.current.rewardsInventory[0]!;

    await act(async () => {
      await result.current.deleteReward(target.id);
    });

    expect(result.current.rewardsInventory.find(r => r.id === target.id)).toBeUndefined();
  });
});

// Rewards center: the mock redeemReward is now a real implementation (was a
// no-op) so the instant-redeem flow is walkable in Test Mode — it deducts the
// shared lifetime total and logs a most-recent-first history record.
describe('MockHouseholdContext instant redemption + history (rewards center)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });

  it('seeds one redemption-history record on the household doc', () => {
    const { result } = captureHousehold();
    const history = result.current.household?.redemptionHistory ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ rewardTitle: 'Movie Night', cost: 50 });
  });

  it('redeemReward deducts the shared total and prepends a history record', async () => {
    const { result } = captureHousehold();
    const beforeTotal = result.current.totalPoints; // seeded at 500
    const beforeHist = result.current.household?.redemptionHistory?.length ?? 0;

    await act(async () => {
      await result.current.redeemReward('rw1'); // Movie Night, cost 50
    });

    expect(result.current.totalPoints).toBe(beforeTotal - 50);
    const history = result.current.household?.redemptionHistory ?? [];
    expect(history).toHaveLength(beforeHist + 1);
    expect(history[0]).toMatchObject({
      rewardId: 'rw1',
      rewardTitle: 'Movie Night',
      cost: 50,
      redeemedByUid: 'test-user-id',
    });
  });

  it('redeemReward rejects when the shared total cannot afford the reward (no deduction, no log)', async () => {
    const { result } = captureHousehold();

    // Drain 500 → 0 via the 100-pt allowance reward (5×), then attempt a 50-pt
    // redemption while the balance is 0.
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await result.current.redeemReward('rw2'); // cost 100
      });
    }
    expect(result.current.totalPoints).toBe(0);

    const histLen = result.current.household?.redemptionHistory?.length ?? 0;
    await act(async () => {
      await result.current.redeemReward('rw1'); // cost 50, but total is 0 → reject
    });

    expect(result.current.totalPoints).toBe(0);
    expect(result.current.household?.redemptionHistory ?? []).toHaveLength(histLen);
  });
});

// Plan 080d-2: reward REDEMPTION through the mock provider. Seeds one pending
// request (redemption_seed_1, allowance reward rw2, cost 100, allowanceCents 500)
// for kid_leo (starting total 220, allowance 0). Exercises the real mock wiring:
// request appends, approve deducts points + credits allowance and is idempotent,
// deny removes without any member change.
describe('MockHouseholdContext reward redemption (Plan 080d-2)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });

  const kid = (result: ReturnType<typeof captureHousehold>['result']) =>
    result.current.members.find(m => m.uid === 'kid_leo')!;

  it('seeds one pending redemption for the kid on the household doc', () => {
    const { result } = captureHousehold();
    const pending = result.current.household?.pendingRedemptions ?? [];
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ memberId: 'kid_leo', type: 'allowance', cost: 100, allowanceCents: 500 });
  });

  it('requestRedemption appends a pending request', async () => {
    const { result } = captureHousehold();
    const before = result.current.household?.pendingRedemptions?.length ?? 0;

    await act(async () => {
      await result.current.requestRedemption('rw1', 'kid_leo'); // realWorld Movie Night
    });

    const pending = result.current.household?.pendingRedemptions ?? [];
    expect(pending).toHaveLength(before + 1);
    const added = pending.find(r => r.rewardId === 'rw1');
    expect(added).toMatchObject({ memberId: 'kid_leo', type: 'realWorld', cost: 50 });
    expect(added).not.toHaveProperty('allowanceCents');
  });

  it('requestRedemption is a no-op the second time for the same (memberId, rewardId)', async () => {
    const { result } = captureHousehold();

    // First request for rw1 → appended.
    await act(async () => {
      await result.current.requestRedemption('rw1', 'kid_leo');
    });
    const afterFirst = (result.current.household?.pendingRedemptions ?? []).filter(r => r.rewardId === 'rw1');
    expect(afterFirst).toHaveLength(1);

    // Second request for the SAME reward + member (double-tap) → skipped.
    await act(async () => {
      await result.current.requestRedemption('rw1', 'kid_leo');
    });
    const afterSecond = (result.current.household?.pendingRedemptions ?? []).filter(r => r.rewardId === 'rw1');
    expect(afterSecond).toHaveLength(1); // still exactly one pending entry
  });

  it('approveRedemption deducts the kid points.total and credits the allowance IOU, then removes the request', async () => {
    const { result } = captureHousehold();
    const before = { ...kid(result).points };
    const beforeAllowance = kid(result).allowanceCents ?? 0;

    await act(async () => {
      await result.current.approveRedemption('redemption_seed_1');
    });

    const after = kid(result);
    expect(after.points.total).toBe(before.total - 100); // cost deducted
    expect(after.allowanceCents).toBe(beforeAllowance + 500); // allowance credited
    // Request removed from the queue.
    expect(result.current.household?.pendingRedemptions ?? []).toHaveLength(0);
  });

  it('approveRedemption is idempotent: a second approve does not deduct again', async () => {
    const { result } = captureHousehold();

    await act(async () => {
      await result.current.approveRedemption('redemption_seed_1');
    });
    const totalAfterFirst = kid(result).points.total;
    const allowanceAfterFirst = kid(result).allowanceCents ?? 0;

    await act(async () => {
      await result.current.approveRedemption('redemption_seed_1'); // already resolved
    });

    expect(kid(result).points.total).toBe(totalAfterFirst);
    expect(kid(result).allowanceCents ?? 0).toBe(allowanceAfterFirst);
  });

  it('approveRedemption rejects (no deduction, request stays pending) when the kid cannot afford the cost', async () => {
    const { result } = captureHousehold();

    // The kid starts at 220 points; the seeded request costs 100. Member points
    // aren't directly settable in the mock, so drain the balance below 100 by
    // approving two allowance redemptions (each -100), then attempt a third while
    // the balance (20) is under the cost. Each rw2 entry is request→approve→stripped
    // before the next request, so the per-(member,reward) dedup never blocks us.
    await act(async () => {
      await result.current.approveRedemption('redemption_seed_1'); // 220 → 120
    });
    await act(async () => {
      await result.current.requestRedemption('rw2', 'kid_leo');
    });
    const second = (result.current.household?.pendingRedemptions ?? []).find(r => r.rewardId === 'rw2')!;
    await act(async () => {
      await result.current.approveRedemption(second.id); // 120 → 20
    });
    expect(kid(result).points.total).toBe(20);

    // Third request: at total 20, cost 100 is unaffordable → approval must no-op.
    await act(async () => {
      await result.current.requestRedemption('rw2', 'kid_leo');
    });
    const third = (result.current.household?.pendingRedemptions ?? []).find(r => r.rewardId === 'rw2')!;
    const totalBefore = kid(result).points.total;
    const allowanceBefore = kid(result).allowanceCents ?? 0;
    const pendingCountBefore = (result.current.household?.pendingRedemptions ?? []).length;

    await act(async () => {
      await result.current.approveRedemption(third.id);
    });

    // No deduction, no allowance credit, and the request remains in the queue.
    expect(kid(result).points.total).toBe(totalBefore);
    expect(kid(result).allowanceCents ?? 0).toBe(allowanceBefore);
    expect(result.current.household?.pendingRedemptions ?? []).toHaveLength(pendingCountBefore);
    expect((result.current.household?.pendingRedemptions ?? []).some(r => r.id === third.id)).toBe(true);
  });

  it('denyRedemption removes the request WITHOUT changing kid points or allowance', async () => {
    const { result } = captureHousehold();
    const before = { ...kid(result).points };
    const beforeAllowance = kid(result).allowanceCents ?? 0;

    await act(async () => {
      await result.current.denyRedemption('redemption_seed_1');
    });

    expect(result.current.household?.pendingRedemptions ?? []).toHaveLength(0);
    expect(kid(result).points.total).toBe(before.total);
    expect(kid(result).allowanceCents ?? 0).toBe(beforeAllowance);
  });
});

// Plan 080e: family challenges. The mock seeds ONE active family challenge and
// exposes addChallenge so the dormant creation flow + the kid challenge card are
// walkable in Test Mode. These exercise the REAL mock wiring through the provider
// and assert the new challenge is DECOUPLED from yearly goals.
describe('MockHouseholdContext family challenges (Plan 080e)', () => {
  const captureGamification = () => renderHook(() => useGamification(), { wrapper });

  it('seeds one active family challenge as the active challenge, decoupled from yearly goals', () => {
    const { result } = captureGamification();
    expect(result.current.challenges).toHaveLength(1);
    const active = result.current.activeChallenge;
    expect(active).not.toBeNull();
    expect(active!.status).toBe('active');
    expect(active!.isFamilyChallenge).toBe(true);
    // Decoupled: no yearly-goal link on a family challenge.
    expect(active!.yearlyGoalId).toBeUndefined();
    expect(active!.relatedHabitIds.length).toBeGreaterThan(0);
  });

  it('addChallenge creates a new active challenge with no yearly coupling', async () => {
    const { result } = captureGamification();
    const before = result.current.challenges.length;

    await act(async () => {
      await result.current.addChallenge({
        title: 'Reading Marathon',
        description: 'Read every night',
        relatedHabitIds: ['h1'],
        targetValue: 30,
      });
    });

    expect(result.current.challenges).toHaveLength(before + 1);
    const created = result.current.challenges.find((c) => c.title === 'Reading Marathon');
    expect(created).toBeDefined();
    expect(created!.status).toBe('active');
    expect(created!.targetType).toBe('count');
    expect(created!.targetValue).toBe(30);
    expect(created!.relatedHabitIds).toEqual(['h1']);
    // No yearly-goal coupling on the created challenge (the whole point of 080e).
    expect(created!.yearlyGoalId).toBeUndefined();
    expect(created!.isFamilyChallenge).toBe(true);
  });

  it('addChallenge omits an empty/zero target rather than storing a junk value', async () => {
    const { result } = captureGamification();

    await act(async () => {
      await result.current.addChallenge({
        title: 'No Target Challenge',
        relatedHabitIds: [],
      });
    });

    const created = result.current.challenges.find((c) => c.title === 'No Target Challenge');
    expect(created).toBeDefined();
    expect(created!.targetValue).toBeUndefined();
  });
});

// Test Mode bug fixes: bucketSpentMap was a hardcoded empty Map (Budget page
// always showed $0 spent) and addTransaction omitted payPeriodId (new pending
// transactions were silently dropped from the Safe-to-Spend pending term).

describe('MockHouseholdContext bucketSpentMap (Budget page spend tracking)', () => {
  it('derives per-bucket spend from the seeded transactions instead of an empty map', () => {
    const finance = captureFinance();
    const groceries = finance.buckets.find((b) => b.name === 'Groceries');
    const utilities = finance.buckets.find((b) => b.name === 'Utilities');
    expect(groceries).toBeDefined();
    expect(utilities).toBeDefined();

    // Seed: Safeway $45.50 (Groceries) + PG&E $120 (Utilities), both verified.
    expect(finance.bucketSpentMap.get(groceries!.id)).toEqual({ verified: 45.5, pending: 0 });
    expect(finance.bucketSpentMap.get(utilities!.id)).toEqual({ verified: 120, pending: 0 });
  });

  it('matches the shared calculateBucketSpent derivation used by the real context', () => {
    const finance = captureFinance();
    expect(finance.bucketSpentMap).toEqual(
      calculateBucketSpent(finance.buckets, finance.transactions, finance.currentPeriodId)
    );
  });

  it('moves the bucket progress when a transaction is added in Test Mode', async () => {
    const { result } = renderHook(() => useFinance(), { wrapper });
    const groceries = result.current.buckets.find((b) => b.name === 'Groceries');
    expect(groceries).toBeDefined();

    await act(async () => {
      await result.current.addTransaction({
        amount: 10.25,
        merchant: "Trader Joe's",
        category: 'Groceries',
        date: getLocalDateString(),
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
      });
    });

    expect(result.current.bucketSpentMap.get(groceries!.id)).toEqual({
      verified: 45.5,
      pending: 10.25,
    });
  });
});

describe('MockHouseholdContext updateTransactionCategory (verify + inline edit parity)', () => {
  it('verifies a $0 needsAmount stub with amount/merchant overrides and credits related habits', async () => {
    const { result } = renderHook(() => useHousehold(), { wrapper });

    await act(async () => {
      await result.current.addTransaction({
        amount: 0,
        merchant: 'Shell',
        category: 'Uncategorized',
        date: getLocalDateString(),
        status: 'pending_review',
        isRecurring: false,
        source: 'shortcut',
        autoCategorized: false,
        needsAmount: true,
      });
    });
    const stub = result.current.transactions.find((t) => t.merchant === 'Shell');
    expect(stub).toBeDefined();

    const habit = result.current.habits[0]!;
    const beforeCount = habit.count;

    await act(async () => {
      await result.current.updateTransactionCategory(stub!.id, 'Gas', [habit.id], undefined, {
        amount: 45.5,
        merchant: 'Shell Gas',
        clearNeedsAmount: true,
      });
    });

    const verified = result.current.transactions.find((t) => t.id === stub!.id)!;
    expect(verified.status).toBe('verified');
    expect(verified.category).toBe('Gas');
    expect(verified.amount).toBe(45.5);
    expect(verified.merchant).toBe('Shell Gas');
    expect(verified.needsAmount).toBe(false);
    expect(verified.relatedHabitIds).toEqual([habit.id]);
    // The related habit gets a count bump (mirrors the mock's toggleHabit).
    expect(result.current.habits.find((h) => h.id === habit.id)!.count).toBe(beforeCount + 1);
  });
});

describe('MockHouseholdContext addTransaction pay period (Safe-to-Spend pending term)', () => {
  it('assigns the mock currentPeriodId so a new pending transaction lowers safeToSpend', async () => {
    const { result } = renderHook(() => useFinance(), { wrapper });
    const before = result.current.safeToSpendBreakdown;
    expect(before?.pendingSpend).toBe(0);

    await act(async () => {
      await result.current.addTransaction({
        amount: 50,
        merchant: 'Receipt Scan Cafe',
        category: 'Entertainment',
        date: getLocalDateString(),
        status: 'pending_review',
        isRecurring: false,
        source: 'camera-scan',
        autoCategorized: true,
      });
    });

    const created = result.current.transactions.find(
      (t) => t.merchant === 'Receipt Scan Cafe'
    );
    expect(created).toBeDefined();
    // Without a payPeriodId matching currentPeriodId, sumPendingSpend drops the tx.
    expect(created!.payPeriodId).toBe(result.current.currentPeriodId);

    const after = result.current.safeToSpendBreakdown;
    expect(after?.pendingSpend).toBe(50);
    expect(after?.safeToSpend).toBe((before?.safeToSpend ?? 0) - 50);
  });
});

describe('MockHouseholdContext saveCeremonyChanges (ceremony balances + budgets save)', () => {
  it('applies bucket limits and account balances together, stamping lastUpdated', async () => {
    const { result } = renderHook(() => useFinance(), { wrapper });
    const groceries = result.current.buckets.find((b) => b.name === 'Groceries');
    const checking = result.current.accounts.find((a) => a.id === 'acc1');
    expect(groceries).toBeDefined();
    expect(checking).toBeDefined();
    const previousStamp = checking!.lastUpdated;

    await act(async () => {
      await result.current.saveCeremonyChanges({
        bucketLimits: [{ id: groceries!.id, limit: 425.559 }],
        accountBalances: [{ id: 'acc1', balance: 5100.129 }],
      });
    });

    // Amounts round to whole cents (decimal dollars, never integer cents).
    expect(result.current.buckets.find((b) => b.id === groceries!.id)?.limit).toBe(425.56);
    const updated = result.current.accounts.find((a) => a.id === 'acc1');
    expect(updated?.balance).toBe(5100.13);
    expect(typeof updated?.lastUpdated).toBe('string');
    expect(updated!.lastUpdated >= previousStamp).toBe(true);
  });

  it('accepts NEGATIVE balances (overdrawn) but drops negative bucket limits', async () => {
    const { result } = renderHook(() => useFinance(), { wrapper });
    const groceries = result.current.buckets.find((b) => b.name === 'Groceries');
    const originalLimit = groceries!.limit;

    await act(async () => {
      await result.current.saveCeremonyChanges({
        bucketLimits: [{ id: groceries!.id, limit: -50 }],
        accountBalances: [{ id: 'acc1', balance: -12.34 }],
      });
    });

    expect(result.current.buckets.find((b) => b.id === groceries!.id)?.limit).toBe(originalLimit);
    expect(result.current.accounts.find((a) => a.id === 'acc1')?.balance).toBe(-12.34);
  });

  it('drops non-finite values and leaves untouched entries alone', async () => {
    const { result } = renderHook(() => useFinance(), { wrapper });
    const savingsBefore = result.current.accounts.find((a) => a.id === 'acc2');

    await act(async () => {
      await result.current.saveCeremonyChanges({
        bucketLimits: [],
        accountBalances: [{ id: 'acc1', balance: Number.NaN }],
      });
    });

    expect(result.current.accounts.find((a) => a.id === 'acc1')?.balance).toBe(5420.5);
    expect(result.current.accounts.find((a) => a.id === 'acc2')).toEqual(savingsBefore);
  });
});

// 🛡️ ROUND-2 REVIEW — Test Mode must route habit points the way production's
// `habitPointsTargets` does (Plan 080c): an ASSIGNED chore credits its
// assignee's own member doc and the shared household pool receives NOTHING.
// The mock sent every habit — kid chores included — through `creditPoints`,
// which paid the test user and inflated the redeemable pool, so Test Mode
// disagreed with production on exactly the path Kid Mode exercises.
describe('MockHouseholdContext habit points routing (assigned vs shared)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });
  const pointsOf = (result: ReturnType<typeof captureHousehold>['result'], uid: string) =>
    result.current.members.find((m) => m.uid === uid)!.points;

  // Seeded fixtures: h3 = 'Clear the Dinner Table', threshold, 5 pts, assigned
  // to the managed kid `kid_leo`. h2 = 'Exercise 30min', a SHARED threshold
  // habit with targetCount 1, so one tap completes it and scores.
  const KID_CHORE = 'h3';
  const SHARED = 'h2';

  it('credits the ASSIGNEE, never the test user or the reward pool, for a kid chore', async () => {
    const { result } = captureHousehold();
    const chore = result.current.habits.find((h) => h.id === KID_CHORE)!;
    expect(chore.assignedTo).toBe('kid_leo');

    const kidBefore = { ...pointsOf(result, 'kid_leo') };
    const userBefore = { ...pointsOf(result, 'test-user-id') };
    const poolBefore = result.current.totalPoints;

    await act(async () => {
      await result.current.toggleHabit(KID_CHORE, 'up');
    });

    const kidAfter = pointsOf(result, 'kid_leo');
    expect(kidAfter.total).toBe(kidBefore.total + chore.basePoints);
    expect(kidAfter.daily).toBe(kidBefore.daily + chore.basePoints);
    expect(kidAfter.weekly).toBe(kidBefore.weekly + chore.basePoints);
    // The parent who tapped earns nothing, and the redeemable pool is untouched.
    expect(pointsOf(result, 'test-user-id')).toEqual(userBefore);
    expect(result.current.totalPoints).toBe(poolBefore);
  });

  it('reverses the ASSIGNEE on a reset — complete→reset is points-neutral for everyone', async () => {
    const { result } = captureHousehold();
    const kidBefore = { ...pointsOf(result, 'kid_leo') };
    const userBefore = { ...pointsOf(result, 'test-user-id') };
    const poolBefore = result.current.totalPoints;

    await act(async () => {
      await result.current.toggleHabit(KID_CHORE, 'up');
    });
    await act(async () => {
      await result.current.resetHabit(KID_CHORE);
    });

    expect(pointsOf(result, 'kid_leo')).toEqual(kidBefore);
    expect(pointsOf(result, 'test-user-id')).toEqual(userBefore);
    expect(result.current.totalPoints).toBe(poolBefore);
  });

  it('still credits the household pool for a SHARED habit (the control case)', async () => {
    const { result } = captureHousehold();
    const shared = result.current.habits.find((h) => h.id === SHARED)!;
    expect(shared.assignedTo).toBeUndefined();

    const kidBefore = { ...pointsOf(result, 'kid_leo') };
    const poolBefore = result.current.totalPoints;

    await act(async () => {
      await result.current.toggleHabit(SHARED, 'up');
    });

    expect(result.current.totalPoints).toBeGreaterThan(poolBefore);
    expect(pointsOf(result, 'kid_leo')).toEqual(kidBefore);
  });

  it('down-toggles the unit off the member who HOLDS the attribution', async () => {
    // 🛡️ Reversal parity with production: a 'down' is bounded by stored
    // attribution, so crediting Jen and then tapping down as the test user
    // takes the unit off JEN — not off whoever happens to be tapping.
    const { result } = captureHousehold();
    const today = getLocalDateString();

    await act(async () => {
      await result.current.creditHabitCompletion(SHARED, ['jen-uid']);
    });
    expect(result.current.habits.find((h) => h.id === SHARED)!.completedBy?.[today])
      .toEqual({ 'jen-uid': 1 });

    await act(async () => {
      await result.current.toggleHabit(SHARED, 'down');
    });

    // Jen's unit is withdrawn; the tapping user never gains a phantom entry.
    const after = result.current.habits.find((h) => h.id === SHARED)!.completedBy?.[today] ?? {};
    expect(after['jen-uid'] ?? 0).toBe(0);
    expect(after['test-user-id']).toBeUndefined();
  });

  it('pays the pool a SECOND award when a second member is credited (stage 1.5)', async () => {
    // 🔒 Locked: "Both of us" credits every selected member a full award and the
    // pool receives the SUM. Test Mode must model that too, or the stage-2
    // picker would look right in the mock and wrong in production.
    const { result } = captureHousehold();

    await act(async () => {
      await result.current.creditHabitCompletion(SHARED, ['jen-uid']);
    });
    const afterFirst = result.current.totalPoints;

    await act(async () => {
      await result.current.creditHabitCompletion(SHARED, ['test-user-id']);
    });
    const secondAward = result.current.totalPoints - afterFirst;
    expect(secondAward).toBeGreaterThan(0);
  });

  it('is pool-neutral across credit → un-credit (reversal symmetry)', async () => {
    const { result } = captureHousehold();
    const poolBefore = result.current.totalPoints;
    const kidBefore = { ...pointsOf(result, 'kid_leo') };

    await act(async () => {
      await result.current.creditHabitCompletion(SHARED, ['kid_leo']);
    });
    expect(result.current.totalPoints).toBeGreaterThan(poolBefore);
    expect(pointsOf(result, 'kid_leo')).not.toEqual(kidBefore);

    await act(async () => {
      await result.current.uncreditHabitCompletion(SHARED, 'kid_leo');
    });
    expect(result.current.totalPoints).toBe(poolBefore);
    expect(pointsOf(result, 'kid_leo')).toEqual(kidBefore);
  });

  it('resets a BELOW-target incremental period back to neutral (wholePeriodClearDates parity)', async () => {
    // 🔒 An incremental habit with `targetCount > 1` scores on every tap but only
    // completes at target, so 2/3 leaves points and attribution with NO
    // completion date. Production's resetHabit reverses that period through
    // `wholePeriodClearDates`; Test Mode must land on the same neutral state, or
    // the mock would look balanced where production diverged.
    const { result } = captureHousehold();
    const today = getLocalDateString();
    const poolBefore = result.current.totalPoints;
    const userBefore = { ...pointsOf(result, 'test-user-id') };

    let id = '';
    await act(async () => {
      id = await result.current.addHabit({
        // `addHabit` takes a full Habit and assigns the real id itself (the
        // Firestore path does the same with an auto-id), so this is a placeholder.
        id: '',
        title: 'Water glasses',
        category: 'Health',
        type: 'positive',
        period: 'daily',
        scoringType: 'incremental',
        basePoints: 10,
        targetCount: 3,
        count: 0,
        totalCount: 0,
        completedDates: [],
        streakDays: 0,
        lastUpdated: new Date().toISOString(),
      });
    });

    await act(async () => {
      await result.current.toggleHabit(id, 'up');
    });
    await act(async () => {
      await result.current.toggleHabit(id, 'up');
    });

    // 2/3: points were credited, nothing entered completedDates.
    const midway = result.current.habits.find((h) => h.id === id)!;
    expect(midway.completedDates).toEqual([]);
    expect(midway.completedBy?.[today]).toEqual({ 'test-user-id': 2 });
    expect(result.current.totalPoints).toBe(poolBefore + 20);

    await act(async () => {
      await result.current.resetHabit(id);
    });

    const after = result.current.habits.find((h) => h.id === id)!;
    expect(after.count).toBe(0);
    expect(after.completedBy?.[today]).toBeUndefined();
    expect(result.current.totalPoints).toBe(poolBefore);
    expect(pointsOf(result, 'test-user-id')).toEqual(userBefore);
  });
});

// Per-member habit points (stage 6): `freezeMode: 'per_member'` auto-apply.
describe('MockHouseholdContext autoApplyFreezes — per-member mode (stage 6)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });
  const d = (n: number) => getLocalDateString(subDays(new Date(), n));
  const MEMBER = 'test-user-id'; // the seeded household's only non-managed adult

  // A positive daily habit with the member's OWN 3-day completed streak ending
  // the day before yesterday, and yesterday missed — a per-member auto-apply
  // candidate identical in shape to the Firebase suite's `protectable`.
  // `id: ''` is a placeholder; `addHabit` assigns the real id (see the
  // pattern above), which is why the parameter is typed `Habit`, not
  // `Omit<Habit, 'id'>`.
  const protectableFor = (title: string): Habit => ({
    id: '',
    title,
    category: 'Health',
    type: 'positive',
    period: 'daily',
    scoringType: 'threshold',
    basePoints: 10,
    targetCount: 1,
    count: 0,
    totalCount: 3,
    completedDates: [d(2), d(3), d(4)],
    completedBy: {
      [d(2)]: { [MEMBER]: 1 },
      [d(3)]: { [MEMBER]: 1 },
      [d(4)]: { [MEMBER]: 1 },
    },
    streakDays: 0,
    lastUpdated: new Date().toISOString(),
  });

  // 🔒 Regression for the finding: `setFreezeBanksByMember`'s per-candidate
  // update used to read `history` off the SAME `prev` snapshot for every
  // candidate in the run, so two habits frozen for the same member in one
  // pass kept only the LAST history entry (the first write was clobbered).
  it('records a history entry for EACH of two habits frozen in one run for one member, not just the last', async () => {
    const { result } = captureHousehold();

    let idA = '';
    let idB = '';
    await act(async () => {
      idA = await result.current.addHabit(protectableFor('Read'));
      idB = await result.current.addHabit(protectableFor('Meditate'));
    });

    await act(async () => {
      await result.current.setFreezeMode('per_member');
    });

    await act(async () => {
      await result.current.autoApplyFreezes();
    });

    // Both habits recorded a per-member freeze for the member on yesterday.
    const habitA = result.current.habits.find(h => h.id === idA)!;
    const habitB = result.current.habits.find(h => h.id === idB)!;
    expect(habitA.frozenDatesBy?.[d(1)]).toEqual([MEMBER]);
    expect(habitB.frozenDatesBy?.[d(1)]).toEqual([MEMBER]);

    // The member's bank recorded BOTH history entries — the bug dropped the
    // first one — and both tokens were spent (fresh bank starts at 2).
    const bank = result.current.householdSettings?.freezeBanksByMember?.[MEMBER];
    expect(bank).toBeDefined();
    expect(bank!.tokens).toBe(0);
    expect(bank!.history).toHaveLength(2);
    expect(bank!.history.map(h => h.habitId).sort()).toEqual([idA, idB].sort());
  });
});

// PR #1156 review fix (F4): the scoreboard widget's PR body claimed the
// household headline and the per-member standings rows could visibly diverge
// in Test Mode because "stage 1.5 [hadn't] landed." Stage 1.5 (#1155) landed
// on main and MockHouseholdContext now derives household daily/weekly as the
// Σ of the ADULT members' own points (kid chore points stay off the pool) —
// so that rationale is stale. This pins the derivation ScoreboardWidget's
// "N pts together" headline actually reads in Test Mode.
describe('MockHouseholdContext household points = Σ of adult members (stage 1.5 parity)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });
  const pointsOf = (result: ReturnType<typeof captureHousehold>['result'], uid: string) =>
    result.current.members.find((m) => m.uid === uid)!.points;

  it('exposes dailyPoints/weeklyPoints as the sum of the seeded adults, excluding the managed kid', () => {
    const { result } = captureHousehold();
    const adults = result.current.members.filter((m) => !m.isManaged);
    const kids = result.current.members.filter((m) => m.isManaged);

    expect(adults.length).toBeGreaterThanOrEqual(2); // Test User + Jordan
    expect(kids.length).toBeGreaterThanOrEqual(1); // Leo

    const expectedDaily = adults.reduce((sum, m) => sum + m.points.daily, 0);
    const expectedWeekly = adults.reduce((sum, m) => sum + m.points.weekly, 0);

    expect(result.current.dailyPoints).toBe(expectedDaily);
    expect(result.current.weeklyPoints).toBe(expectedWeekly);
    // A kid's points must never leak into the household headline the
    // scoreboard widget reads.
    const kidWeeklyTotal = kids.reduce((sum, m) => sum + m.points.weekly, 0);
    expect(kidWeeklyTotal).toBeGreaterThan(0);
    expect(result.current.weeklyPoints).not.toBe(expectedWeekly + kidWeeklyTotal);
  });

  it('moves the household weeklyPoints total when Jordan (a seeded adult) earns points — the scoreboard headline is NOT frozen against member figures', async () => {
    const { result } = captureHousehold();
    const jordanBefore = { ...pointsOf(result, 'test-partner-id') };
    const weeklyBefore = result.current.weeklyPoints;

    await act(async () => {
      await result.current.updateMember('test-partner-id', {
        points: { ...jordanBefore, weekly: jordanBefore.weekly + 40 },
      });
    });

    // The household headline (what ScoreboardWidget renders as "N pts
    // together") must track Jordan's own figure 1:1, not sit frozen.
    expect(result.current.weeklyPoints).toBe(weeklyBefore + 40);
  });
});

// 🛡️ Test Mode is where CLAUDE.md tells agents (and the owner) to verify a
// feature in a browser, so the mock's `addHabitSubmission` must decide period
// completion the way production's `priorPeriodCount` does — across the WHOLE
// period, not just the submission's own day. A DAY-scoped check never completed
// a multi-day threshold period at all, so replaying the two-step past-day flow
// scored nobody where production scores both members.
describe('MockHouseholdContext addHabitSubmission (period-scoped threshold completion)', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });
  const pointsOf = (result: ReturnType<typeof captureHousehold>['result'], uid: string) =>
    result.current.members.find((m) => m.uid === uid)!.points;

  const PAUL = 'test-user-id';
  const JORDAN = 'test-partner-id';
  /** Monday/Wednesday of the LAST fully-closed week — never an offset from a live weekday. */
  const MON = getLocalDateString(startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 }));
  const WED = getLocalDateString(addDays(startOfWeek(subDays(new Date(), 7), { weekStartsOn: 1 }), 2));

  const weeklyPairHabit = {
    title: 'Long run', category: 'Fitness', type: 'positive',
    basePoints: 10, scoringType: 'threshold', period: 'weekly', targetCount: 2,
    totalCount: 0, count: 0, completedDates: [], streakDays: 0,
    createdBy: PAUL, lastUpdated: new Date().toISOString(),
  } as unknown as Omit<Habit, 'id'>;

  it('completes the week on the SECOND day and pays both credited members', async () => {
    const { result } = captureHousehold();

    let habitId = '';
    await act(async () => { habitId = await result.current.addHabit(weeklyPairHabit as Habit); });

    const paulBefore = { ...pointsOf(result, PAUL) };
    const jordanBefore = { ...pointsOf(result, JORDAN) };
    const poolBefore = result.current.totalPoints;

    // Step 1: Paul's Monday → 1 of 2. Nothing completes, nobody scores.
    await act(async () => {
      await result.current.addHabitSubmission(habitId, 1, `${MON}T12:00:00`, undefined, undefined, [PAUL]);
    });
    expect(result.current.habits.find((h) => h.id === habitId)!.completedDates).not.toContain(MON);
    expect(pointsOf(result, PAUL).total).toBe(paulBefore.total);
    expect(result.current.totalPoints).toBe(poolBefore);

    // Step 2: Jordan's Wednesday → the WEEK reaches 2 of 2 and completes. The
    // day-scoped check saw only Wednesday's single unit and never got here.
    await act(async () => {
      await result.current.addHabitSubmission(habitId, 1, `${WED}T12:00:00`, undefined, undefined, [JORDAN]);
    });
    expect(result.current.habits.find((h) => h.id === habitId)!.completedDates).toContain(WED);

    // Both awards reach the pool — Paul's Monday one included, even though this
    // call only named Jordan. Paying only the named member is the F1 bug.
    const poolDelta = result.current.totalPoints - poolBefore;
    expect(poolDelta).toBe(20);

    const paulDelta = pointsOf(result, PAUL).total - paulBefore.total;
    const jordanDelta = pointsOf(result, JORDAN).total - jordanBefore.total;
    expect(jordanDelta).toBe(10);
    // Paul's own Monday unit only earns ITS award once the WEEK completes — a
    // side effect of Jordan's later Wednesday submission, exactly like
    // production's `periodPointsMove` "holders" set. His own total therefore
    // moves by exactly his own +10 threshold award, independent of the pool's
    // figure. Before the fix this used to be `poolDelta + 10`: Paul is
    // MOCK_USER_UID, and `creditHouseholdPool` mirrored the WHOLE pool delta
    // onto his own doc on top of the correct +10 `creditMemberPoints` call
    // below — a double-count that a household-credit completion (crediting
    // the pool, no member at all) turns into a visible scoreboard desync (see
    // the "household credit mode" describe block).
    expect(paulDelta).toBe(10);

    // A closed week: only the lifetime counter moves.
    expect(pointsOf(result, JORDAN).weekly).toBe(jordanBefore.weekly);
    expect(pointsOf(result, JORDAN).daily).toBe(jordanBefore.daily);
  });
});

// 🏁 Household credit mode — Test Mode must model "credits the pool, credits
// nobody" exactly as production does, or the picker's Household row would look
// right in the mock and be wrong in the app.
describe('MockHouseholdContext household credit mode', () => {
  const captureHousehold = () => renderHook(() => useHousehold(), { wrapper });
  const pointsOf = (result: ReturnType<typeof captureHousehold>['result'], uid: string) =>
    result.current.members.find((m) => m.uid === uid)!.points;

  /** Seeded fixture: h4 = 'Homemade Meal', `creditMode: 'household'`, 20 pts. */
  const HOUSEHOLD_HABIT = 'h4';

  it('a tap writes NO completedBy entry and still pays the pool, crediting NEITHER adult — including the signed-in test user', async () => {
    const { result } = captureHousehold();
    const today = getLocalDateString();
    const poolBefore = result.current.totalPoints;
    const userBefore = { ...pointsOf(result, 'test-user-id') };
    const partnerBefore = { ...pointsOf(result, 'test-partner-id') };

    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'up');
    });

    const habit = result.current.habits.find((h) => h.id === HOUSEHOLD_HABIT)!;
    expect(habit.completedBy?.[today]).toBeUndefined();
    expect(habit.completedDates).toContain(today);
    expect(result.current.totalPoints).toBe(poolBefore + 20);
    // 🔒 Regression: `creditHouseholdPool` used to mirror this delta onto the
    // signed-in test user's own member doc (they are `MOCK_USER_UID`), so a
    // household-credit tap looked like it paid the pool AND the tapper — the
    // one actor a household completion must credit is nobody. Jordan (never
    // the mirror's target) already covered the "some OTHER member" case; this
    // pins the actual test-user-id leak.
    expect(pointsOf(result, 'test-user-id')).toEqual(userBefore);
    expect(pointsOf(result, 'test-partner-id')).toEqual(partnerBefore);
  });

  it('is pool-neutral across up → down, debiting no member — including the signed-in test user', async () => {
    const { result } = captureHousehold();
    const poolBefore = result.current.totalPoints;
    const userBefore = { ...pointsOf(result, 'test-user-id') };
    const partnerBefore = { ...pointsOf(result, 'test-partner-id') };

    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'up');
    });
    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'down');
    });

    expect(result.current.totalPoints).toBe(poolBefore);
    expect(pointsOf(result, 'test-user-id')).toEqual(userBefore);
    expect(pointsOf(result, 'test-partner-id')).toEqual(partnerBefore);
  });

  // 🔒 Reconciliation invariant (rewritten, adversarial review of PR #1165).
  //
  // This used to assert `weeklyPoints === Σ adult members` after a
  // household-credit completion — i.e. that the headline does NOT move. That is
  // what Test Mode actually did, and it was the defect: production's household
  // `points.weekly` is `Σ members + unattributed`, and a `creditMode:
  // 'household'` completion moves ONLY the unattributed term. Σ-adults alone
  // matched production for every prior feature only because every completion was
  // attributed to somebody; household credit is the first one that isn't.
  //
  // The consequence was visible, not theoretical: a per-member scoreboard shows
  // its "Household · N" row from the same unattributed term, so in Test Mode the
  // rows failed to sum to the headline above them while production reconciled
  // correctly — defeating browser verification of the invariant.
  //
  // So the assertion is now production's identity, both halves of it: nobody's
  // own score moves, AND the headline moves by exactly the unattributed award.
  it('moves the household headline by the unattributed award, crediting no member', async () => {
    const { result } = captureHousehold();
    const weeklyBefore = result.current.weeklyPoints;
    const dailyBefore = result.current.dailyPoints;
    const poolBefore = result.current.totalPoints;
    const adultsBefore = result.current.members
      .filter((m) => !m.isManaged)
      .map((m) => ({ uid: m.uid, weekly: m.points.weekly, daily: m.points.daily }));

    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'up');
    });

    // Nobody is credited — that IS household credit.
    const adultsAfter = result.current.members.filter((m) => !m.isManaged);
    for (const before of adultsBefore) {
      const after = adultsAfter.find((m) => m.uid === before.uid)!;
      expect(after.points.weekly).toBe(before.weekly);
      expect(after.points.daily).toBe(before.daily);
    }

    // …and yet the household headline moved, by the award the pool received.
    const award = result.current.totalPoints - poolBefore;
    expect(award).toBeGreaterThan(0);
    expect(result.current.weeklyPoints).toBe(weeklyBefore + award);
    expect(result.current.dailyPoints).toBe(dailyBefore + award);

    // 🏁 `household = Σ adults + unattributed`, read off the SAME habit state a
    // scoreboard's "Household" row reads — so its rows sum to its headline.
    const unattributed = decomposeDayPoints(
      result.current.habits,
      adultsAfter.map((m) => m.uid),
      getLocalDateString(),
    ).unattributed;
    const adultDaily = adultsAfter.reduce((sum, m) => sum + m.points.daily, 0);
    expect(unattributed).toBe(award);
    expect(result.current.dailyPoints).toBe(adultDaily + unattributed);
  });

  it('takes the headline back on the down-tap (Σ adults + unattributed, both ways)', async () => {
    const { result } = captureHousehold();
    const weeklyBefore = result.current.weeklyPoints;
    const dailyBefore = result.current.dailyPoints;

    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'up');
    });
    expect(result.current.dailyPoints).toBeGreaterThan(dailyBefore);

    await act(async () => {
      await result.current.toggleHabit(HOUSEHOLD_HABIT, 'down');
    });
    expect(result.current.dailyPoints).toBe(dailyBefore);
    expect(result.current.weeklyPoints).toBe(weeklyBefore);
  });

  it('creditHouseholdCompletion works on a MEMBERS habit as a one-off', async () => {
    const { result } = captureHousehold();
    const today = getLocalDateString();
    const poolBefore = result.current.totalPoints;

    await act(async () => {
      // h2 = 'Exercise 30min', a shared threshold habit with no creditMode.
      await result.current.creditHouseholdCompletion('h2');
    });

    const habit = result.current.habits.find((h) => h.id === 'h2')!;
    expect(habit.completedBy?.[today]).toBeUndefined();
    expect(result.current.totalPoints).toBeGreaterThan(poolBefore);

    await act(async () => {
      await result.current.uncreditHouseholdCompletion('h2');
    });
    expect(result.current.totalPoints).toBe(poolBefore);
  });

  it('an explicit member pick still overrides the household default', async () => {
    const { result } = captureHousehold();
    const today = getLocalDateString();

    await act(async () => {
      await result.current.creditHabitCompletion(HOUSEHOLD_HABIT, ['test-partner-id']);
    });

    const habit = result.current.habits.find((h) => h.id === HOUSEHOLD_HABIT)!;
    expect(habit.completedBy?.[today]).toEqual({ 'test-partner-id': 1 });
  });
});
