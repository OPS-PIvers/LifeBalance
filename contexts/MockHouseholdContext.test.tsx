import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MockHouseholdProvider } from './MockHouseholdContext';
import { useFinance, useHousehold } from './FirebaseHouseholdContext';
import { calculateSafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
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
      finance.buckets,
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
