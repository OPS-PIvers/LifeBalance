import { describe, it, expect } from 'vitest';
import { Account, INCOME_CATEGORY } from '@/types/schema';
import { accountImpactOf, effectiveAccountImpact, resolveTargetAccount } from './accountImpact';

const checking: Account = { id: 'chk', name: 'Checking', type: 'checking', balance: 1000, lastUpdated: '' };
const savings: Account = { id: 'sav', name: 'Savings', type: 'savings', balance: 5000, lastUpdated: '' };
const card: Account = { id: 'cc', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' };

describe('accountImpactOf', () => {
  it('asset checking: income credits, expense debits', () => {
    expect(accountImpactOf({ amount: 50, category: INCOME_CATEGORY }, checking)).toBe(50);
    expect(accountImpactOf({ amount: 50, category: 'Groceries' }, checking)).toBe(-50);
  });

  it('savings behaves like checking (asset)', () => {
    expect(accountImpactOf({ amount: 30, category: INCOME_CATEGORY }, savings)).toBe(30);
    expect(accountImpactOf({ amount: 30, category: 'Groceries' }, savings)).toBe(-30);
  });

  it('untagged (no account) uses legacy asset semantics', () => {
    expect(accountImpactOf({ amount: 40, category: INCOME_CATEGORY }, undefined)).toBe(40);
    expect(accountImpactOf({ amount: 40, category: 'Groceries' }, undefined)).toBe(-40);
  });

  it('credit charge increases debt (+amount)', () => {
    expect(accountImpactOf({ amount: 75, category: 'Groceries' }, card)).toBe(75);
    expect(accountImpactOf({ amount: 75, category: 'Groceries', creditPayment: false }, card)).toBe(75);
  });

  it('credit payment decreases debt (−amount)', () => {
    expect(accountImpactOf({ amount: 75, category: 'Groceries', creditPayment: true }, card)).toBe(-75);
  });

  it('credit + INCOME_CATEGORY is treated as a charge, not income', () => {
    expect(accountImpactOf({ amount: 60, category: INCOME_CATEGORY }, card)).toBe(60);
  });
});

describe('effectiveAccountImpact', () => {
  it('returns 0 for pending_review regardless of account type', () => {
    expect(effectiveAccountImpact({ amount: 50, category: 'Groceries', status: 'pending_review' }, checking)).toBe(0);
    expect(effectiveAccountImpact({ amount: 50, category: 'Groceries', status: 'pending_review' }, card)).toBe(0);
  });

  it('applies the impact for verified transactions', () => {
    expect(effectiveAccountImpact({ amount: 50, category: 'Groceries', status: 'verified' }, checking)).toBe(-50);
    expect(effectiveAccountImpact({ amount: 50, category: 'Groceries', status: 'verified' }, card)).toBe(50);
    expect(effectiveAccountImpact({ amount: 50, category: 'Groceries', creditPayment: true, status: 'verified' }, card)).toBe(-50);
  });
});

describe('resolveTargetAccount', () => {
  const accounts = [checking, savings, card];

  it('returns the tagged account when it exists', () => {
    expect(resolveTargetAccount('cc', accounts)).toBe(card);
    expect(resolveTargetAccount('sav', accounts)).toBe(savings);
  });

  it('falls back to checking when untagged', () => {
    expect(resolveTargetAccount(undefined, accounts)).toBe(checking);
    expect(resolveTargetAccount('', accounts)).toBe(checking);
  });

  it('falls back to checking when the tagged account was deleted', () => {
    expect(resolveTargetAccount('does-not-exist', accounts)).toBe(checking);
  });

  it('returns undefined when no checking account exists and no match', () => {
    expect(resolveTargetAccount('missing', [savings, card])).toBeUndefined();
  });
});
