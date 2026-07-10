import { describe, expect, it } from 'vitest';
import { parseCsv, detectColumns, mapRows, bestDuplicateVerdict, UNCATEGORIZED_CATEGORY } from '@/utils/csvImport';
import { INCOME_CATEGORY } from '@/types/schema';
import type { IdentityTransaction } from '@/utils/transactionIdentity';

describe('parseCsv', () => {
  it('parses plain comma-separated rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('"Smith, John",100.00')).toEqual([['Smith, John', '100.00']]);
  });

  it('handles escaped double-quotes inside a quoted field', () => {
    expect(parseCsv('"Say ""hi""",5')).toEqual([['Say "hi"', '5']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles bare LF and bare CR line endings', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\nc,d\n\n\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('returns an empty array for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });

  it('preserves an embedded newline inside a quoted field', () => {
    expect(parseCsv('"line one\nline two",1')).toEqual([['line one\nline two', '1']]);
  });
});

describe('detectColumns', () => {
  it('detects a single signed-amount header set', () => {
    expect(detectColumns(['Date', 'Description', 'Amount'])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
    });
  });

  it('detects debit/credit split headers', () => {
    expect(detectColumns(['Posted', 'Payee', 'Debit', 'Credit'])).toEqual({
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
    });
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(detectColumns([' TRANSACTION DATE ', ' Memo ', ' AMT '])).toEqual({
      date: 0,
      description: 1,
      amount: 2,
    });
  });

  it('recognizes merchant/name/deposit/withdrawal header variants', () => {
    expect(detectColumns(['Date', 'Merchant', 'Withdrawal', 'Deposit'])).toEqual({
      date: 0,
      description: 1,
      debit: 2,
      credit: 3,
    });
  });

  it('omits columns it cannot confidently match', () => {
    expect(detectColumns(['Date', 'Reference #'])).toEqual({ date: 0 });
  });
});

describe('mapRows', () => {
  it('parses a signed single-amount column, positive = income', () => {
    const { ok, errors } = mapRows(
      [['2026-07-01', 'Paycheck', '1200.00']],
      { date: 0, description: 1, amount: 2 }
    );
    expect(errors).toEqual([]);
    expect(ok).toEqual([{ date: '2026-07-01', amount: 1200, merchant: 'Paycheck', category: INCOME_CATEGORY }]);
  });

  it('parses a signed single-amount column, negative = uncategorized expense', () => {
    const { ok, errors } = mapRows(
      [['07/02/2026', 'Coffee Shop', '-4.50']],
      { date: 0, description: 1, amount: 2 }
    );
    expect(errors).toEqual([]);
    expect(ok).toEqual([{ date: '2026-07-02', amount: 4.5, merchant: 'Coffee Shop', category: UNCATEGORIZED_CATEGORY }]);
  });

  it('handles $ and thousands-comma amount formatting', () => {
    const { ok } = mapRows([['2026-07-01', 'Rent', '-$1,450.00']], { date: 0, description: 1, amount: 2 });
    expect(ok[0]?.amount).toBe(1450);
    expect(ok[0]?.category).toBe(UNCATEGORIZED_CATEGORY);
  });

  it('treats parentheses as negative', () => {
    const { ok } = mapRows([['2026-07-01', 'Groceries', '(45.00)']], { date: 0, description: 1, amount: 2 });
    expect(ok[0]).toEqual({ date: '2026-07-01', amount: 45, merchant: 'Groceries', category: UNCATEGORIZED_CATEGORY });
  });

  it('handles a debit/credit split: debit column populated', () => {
    const { ok, errors } = mapRows(
      [['2026-07-03', 'Gas Station', '38.20', '']],
      { date: 0, description: 1, debit: 2, credit: 3 }
    );
    expect(errors).toEqual([]);
    expect(ok).toEqual([{ date: '2026-07-03', amount: 38.2, merchant: 'Gas Station', category: UNCATEGORIZED_CATEGORY }]);
  });

  it('handles a debit/credit split: credit column populated', () => {
    const { ok, errors } = mapRows(
      [['2026-07-04', 'Direct Deposit', '', '2000.00']],
      { date: 0, description: 1, debit: 2, credit: 3 }
    );
    expect(errors).toEqual([]);
    expect(ok).toEqual([{ date: '2026-07-04', amount: 2000, merchant: 'Direct Deposit', category: INCOME_CATEGORY }]);
  });

  it('accepts MM/DD/YY 2-digit years as 2000+YY', () => {
    const { ok } = mapRows([['7/5/26', 'Store', '10.00']], { date: 0, description: 1, amount: 2 });
    expect(ok[0]?.date).toBe('2026-07-05');
  });

  it('collects an unparseable date into errors with a 1-based file line number', () => {
    const { ok, errors } = mapRows(
      [
        ['2026-07-01', 'Good Row', '10.00'],
        ['not-a-date', 'Bad Row', '10.00'],
      ],
      { date: 0, description: 1, amount: 2 }
    );
    expect(ok).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, reason: 'Unparseable or missing date' }]);
  });

  it('rejects an impossible calendar date (Feb 30)', () => {
    const { ok, errors } = mapRows([['2026-02-30', 'Bad Date', '10.00']], { date: 0, description: 1, amount: 2 });
    expect(ok).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('collects an unparseable amount into errors without throwing', () => {
    const { ok, errors } = mapRows(
      [['2026-07-01', 'Weird Row', 'not-a-number']],
      { date: 0, description: 1, amount: 2 }
    );
    expect(ok).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, reason: 'Unparseable or missing amount' }]);
  });

  it('collects a row missing both debit and credit into errors', () => {
    const { ok, errors } = mapRows(
      [['2026-07-01', 'Nothing', '', '']],
      { date: 0, description: 1, debit: 2, credit: 3 }
    );
    expect(ok).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, reason: 'Unparseable or missing amount' }]);
  });

  it('defaults a blank description to a placeholder merchant instead of erroring', () => {
    const { ok, errors } = mapRows([['2026-07-01', '', '10.00']], { date: 0, description: 1, amount: 2 });
    expect(errors).toEqual([]);
    expect(ok[0]?.merchant).toBe('Imported transaction');
  });

  it('returns empty ok/errors for an empty row set', () => {
    expect(mapRows([], { date: 0, description: 1, amount: 2 })).toEqual({ ok: [], errors: [] });
  });

  it('handles a short row (missing trailing cells) without throwing', () => {
    const { ok, errors } = mapRows([['2026-07-01']], { date: 0, description: 1, amount: 2 });
    expect(ok).toHaveLength(0);
    expect(errors).toEqual([{ line: 2, reason: 'Unparseable or missing amount' }]);
  });
});

describe('bestDuplicateVerdict', () => {
  const row = { date: '2026-07-01', amount: 42, merchant: 'Trader Joes', category: UNCATEGORIZED_CATEGORY };

  it('returns distinct when no existing transaction is close', () => {
    const existing: IdentityTransaction[] = [
      { amount: 5, merchant: 'Gas Station', date: '2026-01-01', category: UNCATEGORIZED_CATEGORY, status: 'verified' },
    ];
    expect(bestDuplicateVerdict(row, existing)).toBe('distinct');
  });

  it('returns possible (never duplicate) for a same-day same-amount similar-merchant pending row when neither side has an accountId', () => {
    // isLikelyDuplicate requires BOTH accountIds known to reach 'duplicate' — CSV
    // rows are never account-tagged in v1, so the strongest verdict they can ever
    // earn is 'possible' (the module is deliberately conservative without account
    // confirmation). This pins that behavior for the drawer's dedup UI.
    const existing: IdentityTransaction[] = [
      { amount: 42, merchant: 'Trader Joe\'s', date: '2026-07-01', category: UNCATEGORIZED_CATEGORY, status: 'pending_review' },
    ];
    expect(bestDuplicateVerdict(row, existing)).toBe('possible');
  });

  it('returns possible for a same-amount match a few days apart', () => {
    const existing: IdentityTransaction[] = [
      { amount: 42, merchant: 'Trader Joes', date: '2026-07-03', category: UNCATEGORIZED_CATEGORY, status: 'pending_review' },
    ];
    expect(bestDuplicateVerdict(row, existing)).toBe('possible');
  });

  it('returns the strongest verdict seen across multiple candidates (possible beats distinct)', () => {
    const existing: IdentityTransaction[] = [
      { amount: 999, merchant: 'Unrelated', date: '2020-01-01', category: UNCATEGORIZED_CATEGORY, status: 'verified' },
      { amount: 42, merchant: 'Trader Joes', date: '2026-07-02', category: UNCATEGORIZED_CATEGORY, status: 'pending_review' },
    ];
    expect(bestDuplicateVerdict(row, existing)).toBe('possible');
  });
});
