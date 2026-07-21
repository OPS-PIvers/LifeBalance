import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MockHouseholdProvider } from './MockHouseholdContext';
import { useFinance, useGamification, useHousehold } from './FirebaseHouseholdContext';
import { calculateSafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { calculateBucketSpent } from '@/utils/bucketSpentCalculator';
import { DEFAULT_TODO_POINTS } from '@/utils/todoPoints';
import { getLocalDateString } from '@/utils/dateHelpers';

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
