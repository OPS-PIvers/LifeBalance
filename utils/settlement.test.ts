import { describe, it, expect } from 'vitest';
import {
  splitParticipantKey,
  isMemberParticipant,
  validateSplit,
  splitEvenly,
  computeMemberBalances,
  computeExternalOwed,
  memberDisplayName,
} from '@/utils/settlement';
import { HouseholdMember, Transaction } from '@/types/schema';

const members: HouseholdMember[] = [
  { uid: 'alice', displayName: 'Alice', role: 'admin', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'bob', displayName: 'Bob', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'carol', displayName: 'Carol', role: 'member', points: { daily: 0, weekly: 0, total: 0 } },
];

function tx(partial: Partial<Transaction> & { id: string }): Transaction {
  return {
    amount: 100,
    merchant: 'Test',
    category: 'Groceries',
    date: '2026-07-14',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...partial,
  };
}

describe('splitParticipantKey', () => {
  it('keys members by uid and externals by lowercased email', () => {
    expect(splitParticipantKey({ memberId: 'bob', shareAmount: 5 })).toBe('member:bob');
    expect(splitParticipantKey({ email: 'A@B.com', shareAmount: 5 })).toBe('email:a@b.com');
  });
});

describe('isMemberParticipant', () => {
  it('distinguishes members from external emails', () => {
    expect(isMemberParticipant({ memberId: 'bob', shareAmount: 1 })).toBe(true);
    expect(isMemberParticipant({ email: 'x@y.com', shareAmount: 1 })).toBe(false);
  });
});

describe('validateSplit', () => {
  it('accepts shares summing to less than the total (payer keeps remainder)', () => {
    const r = validateSplit(100, [{ memberId: 'bob', shareAmount: 40 }]);
    expect(r.valid).toBe(true);
    expect(r.payerRemainder).toBe(60);
  });

  it('accepts an exact-total split (zero payer remainder)', () => {
    const r = validateSplit(30, [
      { memberId: 'bob', shareAmount: 15 },
      { memberId: 'carol', shareAmount: 15 },
    ]);
    expect(r.valid).toBe(true);
    expect(r.payerRemainder).toBe(0);
  });

  it('rejects shares exceeding the total', () => {
    const r = validateSplit(30, [{ memberId: 'bob', shareAmount: 40 }]);
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/more than/i);
  });

  it('rejects a negative share', () => {
    expect(validateSplit(30, [{ memberId: 'bob', shareAmount: -1 }]).valid).toBe(false);
  });

  it('rejects a participant with neither member nor email', () => {
    expect(validateSplit(30, [{ shareAmount: 5 }]).valid).toBe(false);
  });

  it('uses the absolute total so negative-amount transactions still validate', () => {
    expect(validateSplit(-50, [{ memberId: 'bob', shareAmount: 25 }]).valid).toBe(true);
  });
});

describe('splitEvenly', () => {
  it('distributes leftover cents so parts sum exactly to the total', () => {
    const parts = splitEvenly(10, 3);
    expect(parts).toEqual([3.34, 3.33, 3.33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5);
  });

  it('splits evenly when divisible', () => {
    expect(splitEvenly(30, 2)).toEqual([15, 15]);
  });

  it('returns [] for non-positive counts', () => {
    expect(splitEvenly(10, 0)).toEqual([]);
  });
});

describe('computeMemberBalances', () => {
  it('nets a single split into one directed debt', () => {
    const txns = [tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 20 }] })];
    const balances = computeMemberBalances(txns, members);
    expect(balances).toEqual([{ fromMemberId: 'bob', toMemberId: 'alice', amount: 20 }]);
  });

  it('nets opposite-direction debts between the same pair', () => {
    const txns = [
      tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 30 }] }),
      tx({ id: 't2', createdBy: 'bob', splitWith: [{ memberId: 'alice', shareAmount: 10 }] }),
    ];
    const balances = computeMemberBalances(txns, members);
    expect(balances).toEqual([{ fromMemberId: 'bob', toMemberId: 'alice', amount: 20 }]);
  });

  it('cancels a pair that nets to zero', () => {
    const txns = [
      tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 10 }] }),
      tx({ id: 't2', createdBy: 'bob', splitWith: [{ memberId: 'alice', shareAmount: 10 }] }),
    ];
    expect(computeMemberBalances(txns, members)).toEqual([]);
  });

  it('ignores settled shares', () => {
    const txns = [tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 20, settled: true }] })];
    expect(computeMemberBalances(txns, members)).toEqual([]);
  });

  it('ignores external (email) participants', () => {
    const txns = [tx({ id: 't1', createdBy: 'alice', splitWith: [{ email: 'x@y.com', shareAmount: 20 }] })];
    expect(computeMemberBalances(txns, members)).toEqual([]);
  });

  it('ignores a share whose payer is not a member', () => {
    const txns = [tx({ id: 't1', createdBy: 'ghost', splitWith: [{ memberId: 'bob', shareAmount: 20 }] })];
    expect(computeMemberBalances(txns, members)).toEqual([]);
  });

  it('ignores a self-share (payer owing themselves)', () => {
    const txns = [tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'alice', shareAmount: 20 }] })];
    expect(computeMemberBalances(txns, members)).toEqual([]);
  });

  it('sorts multiple pair debts largest-first', () => {
    const txns = [
      tx({ id: 't1', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 5 }] }),
      tx({ id: 't2', createdBy: 'alice', splitWith: [{ memberId: 'carol', shareAmount: 50 }] }),
    ];
    const balances = computeMemberBalances(txns, members);
    expect(balances.map(b => b.amount)).toEqual([50, 5]);
  });
});

describe('computeExternalOwed', () => {
  it('aggregates unsettled external shares by email', () => {
    const txns = [
      tx({ id: 't1', createdBy: 'alice', splitWith: [{ email: 'dan@x.com', name: 'Dan', shareAmount: 10, invitedAt: '2026-07-01' }] }),
      tx({ id: 't2', createdBy: 'alice', splitWith: [{ email: 'DAN@x.com', shareAmount: 5 }] }),
    ];
    expect(computeExternalOwed(txns)).toEqual([
      { email: 'dan@x.com', name: 'Dan', amount: 15, invited: true },
    ]);
  });

  it('excludes settled and member shares', () => {
    const txns = [
      tx({ id: 't1', createdBy: 'alice', splitWith: [{ email: 'dan@x.com', shareAmount: 10, settled: true }] }),
      tx({ id: 't2', createdBy: 'alice', splitWith: [{ memberId: 'bob', shareAmount: 10 }] }),
    ];
    expect(computeExternalOwed(txns)).toEqual([]);
  });
});

describe('memberDisplayName', () => {
  it('returns the display name or a fallback', () => {
    expect(memberDisplayName('bob', members)).toBe('Bob');
    expect(memberDisplayName('ghost', members)).toBe('Member');
  });
});
