import { describe, it, expect } from 'vitest';
import type { MerchantRule } from '@/types/schema';
import {
  BILL_AMOUNT_ABS_TOLERANCE,
  BILL_AMOUNT_PCT_TOLERANCE,
  billAmountWithinTolerance,
  matchesAlias,
  pickBillToPay,
  shareSignificantToken,
  significantTokens,
  type BillPayCandidate,
} from '@/utils/billDescriptorMatch';

const bill = (overrides: Partial<BillPayCandidate> = {}): BillPayCandidate => ({
  id: 'bill-1',
  title: 'Xcel Energy',
  amount: 120,
  ...overrides,
});

const rule = (overrides: Partial<MerchantRule> = {}): MerchantRule => ({
  id: 'rule-1',
  pattern: 'CPENERGY',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('significantTokens / shareSignificantToken', () => {
  it('drops generic bank noise, short tokens and digit-only tokens', () => {
    expect(significantTokens('AMERICAN EXPRESS ACH PMT 240725')).toEqual([
      'AMERICAN',
      'EXPRESS',
    ]);
  });

  it('does not match two bills purely on a shared noise word', () => {
    expect(shareSignificantToken('AMERICAN EXPRESS ACH PMT', 'Water Bill AUTOPAY')).toBe(false);
  });

  it('matches on a genuinely shared identifying token', () => {
    expect(shareSignificantToken('XCEL ENERGY WEB PYMT', 'Xcel Energy')).toBe(true);
  });
});

describe('matchesAlias', () => {
  it('is exact normalized equality, case- and whitespace-insensitive', () => {
    expect(matchesAlias('cpenergy   mngco', ['CPENERGY MNGCO'])).toBe(true);
  });

  it('is NOT substring or prefix matching — pin this, do not loosen it', () => {
    expect(matchesAlias('CPENERGY MNGCO 4471', ['CPENERGY MNGCO'])).toBe(false);
    expect(matchesAlias('CPENERGY', ['CPENERGY MNGCO'])).toBe(false);
  });

  it('is false with no aliases learned yet', () => {
    expect(matchesAlias('CPENERGY MNGCO', undefined)).toBe(false);
    expect(matchesAlias('CPENERGY MNGCO', [])).toBe(false);
  });
});

describe('billAmountWithinTolerance', () => {
  it('pins the thresholds at 10% or $25, whichever is larger', () => {
    expect(BILL_AMOUNT_PCT_TOLERANCE).toBe(0.1);
    expect(BILL_AMOUNT_ABS_TOLERANCE).toBe(25);
    // $25 floor wins on a small bill.
    expect(billAmountWithinTolerance(50, 74)).toBe(true);
    expect(billAmountWithinTolerance(50, 76)).toBe(false);
    // 10% wins on a large one.
    expect(billAmountWithinTolerance(1000, 1100)).toBe(true);
    expect(billAmountWithinTolerance(1000, 1101)).toBe(false);
  });

  // The owner's own pair. Reported as $142.00 budgeted vs a $37.91 charge.
  it('rejects the reported Centerpoint gap ($142.00 bill vs $37.91 charge)', () => {
    expect(billAmountWithinTolerance(142, 37.91)).toBe(false);
  });
});

describe('pickBillToPay', () => {
  it('matches a learned alias (matchedBy "alias")', () => {
    const learned = bill({ title: 'Natural Gas', bankDescriptorAliases: ['CPENERGY MNGCO'] });
    const got = pickBillToPay({ descriptor: 'Cpenergy Mngco', amount: 118 }, [learned]);
    expect(got?.bill.id).toBe('bill-1');
    expect(got?.matchedBy).toBe('alias');
  });

  it('matches on title token-overlap when no alias was learned (matchedBy "token")', () => {
    const got = pickBillToPay({ descriptor: 'XCEL ENERGY WEB PYMT', amount: 118 }, [bill()]);
    expect(got?.matchedBy).toBe('token');
  });

  it('refuses an alias match outside the amount tolerance', () => {
    const learned = bill({
      amount: 142,
      title: 'Centerpoint Energy (Natural Gas)',
      bankDescriptorAliases: ['CPENERGY MNGCO'],
    });
    expect(pickBillToPay({ descriptor: 'Cpenergy Mngco', amount: 37.91 }, [learned])).toBeNull();
  });

  it('refuses to guess when two candidates are ambiguous', () => {
    const a = bill({ id: 'a', title: 'Xcel Energy' });
    const b = bill({ id: 'b', title: 'Xcel Energy Gas' });
    expect(pickBillToPay({ descriptor: 'XCEL ENERGY WEB PYMT', amount: 118 }, [a, b])).toBeNull();
  });

  it("honours a merchant rule's billId and BYPASSES the amount tolerance", () => {
    // The variable-amount utility: nothing else can match this pair, which is
    // exactly what an explicit household rule exists for.
    const centerpoint = bill({
      id: 'tmpl-gas',
      amount: 142,
      title: 'Centerpoint Energy (Natural Gas)',
    });
    const got = pickBillToPay(
      { descriptor: 'Cpenergy Mngco', amount: 37.91 },
      [centerpoint],
      [rule({ billId: 'tmpl-gas' })],
    );
    expect(got?.bill.id).toBe('tmpl-gas');
    expect(got?.matchedBy).toBe('rule');
  });

  it("resolves a rule's billId against an expanded occurrence via templateId", () => {
    const occurrence = bill({
      id: 'tmpl-gas_instance_2026-07-27',
      templateId: 'tmpl-gas',
      amount: 142,
      title: 'Centerpoint Energy (Natural Gas)',
    });
    const got = pickBillToPay(
      { descriptor: 'Cpenergy Mngco', amount: 37.91 },
      [occurrence],
      [rule({ billId: 'tmpl-gas' })],
    );
    expect(got?.matchedBy).toBe('rule');
  });

  it('falls through to the weaker tiers when the rule names nothing in the pool', () => {
    const got = pickBillToPay(
      { descriptor: 'XCEL ENERGY WEB PYMT', amount: 118 },
      [bill()],
      [rule({ pattern: 'XCEL', billId: 'some-other-bill' })],
    );
    expect(got?.matchedBy).toBe('token');
  });

  it('returns null with no candidates and behaves identically with no rules', () => {
    expect(pickBillToPay({ descriptor: 'XCEL ENERGY', amount: 118 }, [])).toBeNull();
    expect(pickBillToPay({ descriptor: 'XCEL ENERGY WEB PYMT', amount: 118 }, [bill()], [])?.matchedBy)
      .toBe('token');
  });

  // The reported paper cut, matched end-to-end at the pure layer: the two
  // strings share NO significant token AND the amounts are far apart, so
  // nothing links them until the household teaches the link.
  it('does NOT link the reported Centerpoint/Cpenergy pair on its first sighting', () => {
    const centerpoint = bill({
      id: 'tmpl-gas',
      amount: 142,
      title: 'Centerpoint Energy (Natural Gas)',
    });
    expect(shareSignificantToken('Cpenergy Mngco', 'Centerpoint Energy (Natural Gas)')).toBe(false);
    expect(pickBillToPay({ descriptor: 'Cpenergy Mngco', amount: 37.91 }, [centerpoint])).toBeNull();
  });
});
