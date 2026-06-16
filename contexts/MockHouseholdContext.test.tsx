import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderHook } from '@testing-library/react';
import { MockHouseholdProvider } from './MockHouseholdContext';
import { useFinance } from './FirebaseHouseholdContext';
import { calculateSafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';

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
