import { describe, it, expect } from 'vitest';
import { getCardOwnerUid, normalizeCardDigits } from './cardOwnership';
import type { Account } from '@/types/schema';

describe('normalizeCardDigits', () => {
  it('extracts 4 digits from masked forms', () => {
    expect(normalizeCardDigits('...8899')).toBe('8899');
    expect(normalizeCardDigits('…8899')).toBe('8899');
    expect(normalizeCardDigits('8899')).toBe('8899');
    expect(normalizeCardDigits('  8899  ')).toBe('8899');
  });

  it('returns null for unusable input', () => {
    expect(normalizeCardDigits('')).toBeNull();
    expect(normalizeCardDigits('123')).toBeNull();
    expect(normalizeCardDigits(undefined)).toBeNull();
    expect(normalizeCardDigits(null)).toBeNull();
  });
});

describe('getCardOwnerUid', () => {
  const baseAccount: Account = {
    id: 'acc1',
    name: 'Shared Checking',
    type: 'checking',
    balance: 1000,
    lastUpdated: '2026-01-01',
  };

  it('returns the tagged member uid for a card with an assigned owner', () => {
    const account: Account = {
      ...baseAccount,
      cardLast4s: ['1111', '2222'],
      cardOwners: { '1111': 'uid-paul', '2222': 'uid-jen' },
    };
    expect(getCardOwnerUid(account, '1111')).toBe('uid-paul');
    expect(getCardOwnerUid(account, '2222')).toBe('uid-jen');
  });

  it('returns undefined for an untagged card even when cardOwners has other entries', () => {
    const account: Account = {
      ...baseAccount,
      cardLast4s: ['1111', '2222'],
      cardOwners: { '1111': 'uid-paul' },
    };
    expect(getCardOwnerUid(account, '2222')).toBeUndefined();
  });

  it('returns undefined when the account has no cardOwners map at all (legacy account)', () => {
    const legacyAccount: Account = {
      ...baseAccount,
      cardLast4: '8899',
      // No cardLast4s, no cardOwners — a pre-CARD-1 document.
    };
    expect(getCardOwnerUid(legacyAccount, '8899')).toBeUndefined();
  });

  it('returns undefined for an account with cardLast4s but an empty cardOwners map', () => {
    const account: Account = {
      ...baseAccount,
      cardLast4s: ['1111'],
      cardOwners: {},
    };
    expect(getCardOwnerUid(account, '1111')).toBeUndefined();
  });

  it('returns undefined when account is null/undefined', () => {
    expect(getCardOwnerUid(undefined, '1111')).toBeUndefined();
    expect(getCardOwnerUid(null, '1111')).toBeUndefined();
  });

  it('returns undefined when the lookup digits are unusable', () => {
    const account: Account = {
      ...baseAccount,
      cardOwners: { '1111': 'uid-paul' },
    };
    expect(getCardOwnerUid(account, '')).toBeUndefined();
    expect(getCardOwnerUid(account, null)).toBeUndefined();
    expect(getCardOwnerUid(account, undefined)).toBeUndefined();
  });

  it('normalizes a masked card-last-4 before lookup', () => {
    const account: Account = {
      ...baseAccount,
      cardLast4s: ['8899'],
      cardOwners: { '8899': 'uid-paul' },
    };
    expect(getCardOwnerUid(account, '...8899')).toBe('uid-paul');
  });
});
