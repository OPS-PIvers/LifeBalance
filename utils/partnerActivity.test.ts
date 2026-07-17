import { describe, it, expect } from 'vitest';
import {
  selectPartnerActivity,
  partnerNames,
  PARTNER_ACTIVITY_MIN_AMOUNT,
  PARTNER_ACTIVITY_MAX_ITEMS,
  type SelectPartnerActivityArgs,
} from '@/utils/partnerActivity';
import type { Transaction, HouseholdMember } from '@/types/schema';
import { INCOME_CATEGORY } from '@/types/schema';

const members: HouseholdMember[] = [
  { uid: 'me', displayName: 'Alex', role: 'admin', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'partner', displayName: 'Jordan', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'third', displayName: 'Sam', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
];

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    amount: 50,
    merchant: 'Costco',
    category: 'Groceries',
    date: '2026-07-16',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    createdBy: 'partner',
    createdAt: '2026-07-16T12:00:00.000Z',
    ...overrides,
  };
}

const base: Omit<SelectPartnerActivityArgs, 'transactions'> = {
  members,
  lastVisitISO: '2026-07-15T00:00:00.000Z',
  currentMemberId: 'me',
};

describe('selectPartnerActivity', () => {
  it('surfaces an attributed above-threshold transaction from another member', () => {
    const result = selectPartnerActivity({ ...base, transactions: [tx({ id: 't1' })] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 't1',
      memberUid: 'partner',
      memberName: 'Jordan',
      merchant: 'Costco',
      amount: 50,
    });
  });

  it('returns nothing when there is no recorded prior visit (first run)', () => {
    const result = selectPartnerActivity({ ...base, lastVisitISO: null, transactions: [tx({ id: 't1' })] });
    expect(result).toEqual([]);
  });

  it('returns nothing for an unparseable lastVisit', () => {
    const result = selectPartnerActivity({ ...base, lastVisitISO: 'not-a-date', transactions: [tx({ id: 't1' })] });
    expect(result).toEqual([]);
  });

  it('filters out the viewer’s own transactions', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', createdBy: 'me' })],
    });
    expect(result).toEqual([]);
  });

  it('skips unattributed (legacy) transactions with no createdBy', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', createdBy: undefined })],
    });
    expect(result).toEqual([]);
  });

  it('skips a createdBy that no longer maps to a member', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', createdBy: 'ghost' })],
    });
    expect(result).toEqual([]);
  });

  it('excludes transactions at or before the last visit', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [
        tx({ id: 'old', createdAt: '2026-07-14T12:00:00.000Z' }),
        tx({ id: 'exact', createdAt: base.lastVisitISO! }),
      ],
    });
    expect(result).toEqual([]);
  });

  it('skips transactions with no createdAt timestamp', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', createdAt: undefined })],
    });
    expect(result).toEqual([]);
  });

  it('excludes sub-threshold spend but keeps amounts at the threshold', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [
        tx({ id: 'small', amount: PARTNER_ACTIVITY_MIN_AMOUNT - 0.01 }),
        tx({ id: 'edge', amount: PARTNER_ACTIVITY_MIN_AMOUNT }),
      ],
    });
    expect(result.map(r => r.id)).toEqual(['edge']);
  });

  it('honors a custom minAmount', () => {
    const result = selectPartnerActivity({
      ...base,
      minAmount: 100,
      transactions: [tx({ id: 't1', amount: 50 })],
    });
    expect(result).toEqual([]);
  });

  it('treats large negative amounts by absolute value', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', amount: -75 })],
    });
    expect(result).toHaveLength(1);
  });

  it('excludes income', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [tx({ id: 't1', category: INCOME_CATEGORY, amount: 2000 })],
    });
    expect(result).toEqual([]);
  });

  it('sorts newest-first and caps at the limit', () => {
    const many = Array.from({ length: PARTNER_ACTIVITY_MAX_ITEMS + 3 }, (_, i) =>
      tx({ id: `t${i}`, createdAt: `2026-07-16T${String(i + 1).padStart(2, '0')}:00:00.000Z` })
    );
    const result = selectPartnerActivity({ ...base, transactions: many });
    expect(result).toHaveLength(PARTNER_ACTIVITY_MAX_ITEMS);
    // Newest (highest hour) first.
    const times = result.map(r => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(result[0]!.id).toBe(`t${PARTNER_ACTIVITY_MAX_ITEMS + 2}`);
  });

  it('includes activity from multiple other members', () => {
    const result = selectPartnerActivity({
      ...base,
      transactions: [
        tx({ id: 't1', createdBy: 'partner', createdAt: '2026-07-16T10:00:00.000Z' }),
        tx({ id: 't2', createdBy: 'third', createdAt: '2026-07-16T11:00:00.000Z' }),
      ],
    });
    expect(result.map(r => r.memberName)).toEqual(['Sam', 'Jordan']);
  });

  it('handles a null current member (no viewer to exclude)', () => {
    const result = selectPartnerActivity({
      ...base,
      currentMemberId: null,
      transactions: [tx({ id: 't1', createdBy: 'partner' })],
    });
    expect(result).toHaveLength(1);
  });
});

describe('partnerNames', () => {
  it('returns distinct names in first-appearance order', () => {
    const items = selectPartnerActivity({
      ...base,
      transactions: [
        tx({ id: 't1', createdBy: 'third', createdAt: '2026-07-16T11:00:00.000Z' }),
        tx({ id: 't2', createdBy: 'partner', createdAt: '2026-07-16T10:00:00.000Z' }),
        tx({ id: 't3', createdBy: 'third', createdAt: '2026-07-16T09:00:00.000Z' }),
      ],
    });
    expect(partnerNames(items)).toEqual(['Sam', 'Jordan']);
  });

  it('is empty for an empty digest', () => {
    expect(partnerNames([])).toEqual([]);
  });
});
