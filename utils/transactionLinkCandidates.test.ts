import { describe, it, expect } from 'vitest';

import { getTransactionLinkCandidates } from '@/utils/transactionLinkCandidates';
import { INCOME_CATEGORY, type Transaction } from '@/types/schema';

const tx = (over: Partial<Transaction> & { id: string; date: string }): Transaction => ({
  amount: 40,
  merchant: 'Cpenergy Mngco',
  category: 'Utilities',
  status: 'pending_review',
  isRecurring: false,
  source: 'image-capture',
  autoCategorized: false,
  ...over,
});

const ids = (rows: Transaction[]) => rows.map(r => r.id);

describe('getTransactionLinkCandidates', () => {
  it('sorts nearest-to-the-bill-date first, not most-recent-first', () => {
    const rows = [
      // The most RECENT row, but 33 days from the bill: recency alone would
      // rank it first; distance from the bill's own date ranks it last.
      tx({ id: 'newest', date: '2026-08-20' }),
      tx({ id: 'near', date: '2026-07-19' }),
      tx({ id: 'mid-past', date: '2026-06-25' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18' })))
      .toEqual(['near', 'mid-past', 'newest']);
  });

  it('breaks an equal-distance tie toward the LATER charge (bills are paid on/after their due date)', () => {
    const rows = [
      tx({ id: 'before', date: '2026-07-15' }),
      tx({ id: 'after', date: '2026-07-21' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18' })))
      .toEqual(['after', 'before']);
  });

  it('excludes rows that cannot settle a bill: already linked, income, $0 stubs', () => {
    const rows = [
      tx({ id: 'ok', date: '2026-07-18' }),
      tx({ id: 'already-linked', date: '2026-07-18', paidCalendarItemId: 'paid-doc-1' }),
      tx({ id: 'income', date: '2026-07-18', category: INCOME_CATEGORY }),
      tx({ id: 'stub', date: '2026-07-18', amount: 0, needsAmount: true }),
      tx({ id: 'zero', date: '2026-07-18', amount: 0 }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18' }))).toEqual(['ok']);
  });

  it('keeps BOTH pending_review and verified rows — a charge you already approved is often the bill', () => {
    const rows = [
      tx({ id: 'pending', date: '2026-07-18', status: 'pending_review' }),
      tx({ id: 'verified', date: '2026-07-18', status: 'verified' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18' })).sort())
      .toEqual(['pending', 'verified']);
  });

  it('matches the query case-insensitively against every supplied search term', () => {
    const rows = [
      tx({ id: 'gas', date: '2026-07-18', merchant: 'CPENERGY MNGCO' }),
      tx({ id: 'coffee', date: '2026-07-18', merchant: 'Blue Bottle' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18', query: 'cpenergy' })))
      .toEqual(['gas']);
    // A merchant-rule-renamed row stays findable by the FRIENDLY name too — the
    // picker passes useMerchantRules().searchTermsFor, which yields both.
    expect(ids(getTransactionLinkCandidates(rows, {
      anchorDate: '2026-07-18',
      query: 'gas bill',
      searchTermsFor: (t) => (t.id === 'gas' ? [t.merchant, 'Gas bill'] : [t.merchant]),
    }))).toEqual(['gas']);
  });

  it('falls back to the stored merchant + store when no searchTermsFor is given', () => {
    const rows = [tx({ id: 'x', date: '2026-07-18', merchant: 'SQ *THING', store: 'Target' })];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18', query: 'target' })))
      .toEqual(['x']);
  });

  it('honours the limit and never mutates the caller array', () => {
    const rows = [
      tx({ id: 'a', date: '2026-07-18' }),
      tx({ id: 'b', date: '2026-07-25' }),
      tx({ id: 'c', date: '2026-06-01' }),
    ];
    const snapshot = ids(rows);
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18', limit: 2 })))
      .toEqual(['a', 'b']);
    expect(ids(rows)).toEqual(snapshot);
  });

  it('degrades to most-recent-first when the anchor date is unparseable', () => {
    const rows = [
      tx({ id: 'old', date: '2026-06-01' }),
      tx({ id: 'new', date: '2026-07-25' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: 'not-a-date' })))
      .toEqual(['new', 'old']);
  });

  it('does not drop a row whose OWN date is unparseable — it just sorts last', () => {
    const rows = [
      tx({ id: 'bad', date: 'garbage' }),
      tx({ id: 'good', date: '2026-07-18' }),
    ];
    expect(ids(getTransactionLinkCandidates(rows, { anchorDate: '2026-07-18' })))
      .toEqual(['good', 'bad']);
  });
});
