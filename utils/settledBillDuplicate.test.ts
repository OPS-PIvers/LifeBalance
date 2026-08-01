import { describe, it, expect } from 'vitest';

import { INCOME_CATEGORY, type CalendarItem, type Transaction } from '@/types/schema';
import { BUDGETED_IN_CALENDAR } from '@/utils/categories';
import {
  SETTLED_BILL_DUPLICATE_WINDOW_DAYS,
  aliasTargetForSettledRow,
  findSettledBillDuplicate,
} from '@/utils/settledBillDuplicate';

/** The recurring template — where learned aliases live. */
const template: CalendarItem = {
  id: 'cal-tmpl',
  title: 'Centerpoint Energy (Natural Gas)',
  amount: 142,
  date: '2026-07-05',
  type: 'expense',
  isPaid: false,
  isRecurring: true,
  frequency: 'monthly',
};

/**
 * The paid-instance calendar doc `payCalendarItem` creates for a recurring
 * occurrence, pointing back at its template.
 */
const paidInstance: CalendarItem = {
  id: 'cal-paid',
  title: 'Centerpoint Energy (Natural Gas)',
  amount: 142,
  date: '2026-07-05',
  type: 'expense',
  isPaid: true,
  isRecurring: false,
  parentRecurringId: 'cal-tmpl',
};

/** The hand-paid half — exactly what `payCalendarItem` writes. */
const settledRow: Transaction = {
  id: 'tx-manual',
  amount: 142,
  merchant: 'Centerpoint Energy (Natural Gas)',
  category: BUDGETED_IN_CALENDAR,
  date: '2026-07-05',
  status: 'verified',
  isRecurring: true,
  source: 'recurring',
  autoCategorized: true,
  accountId: 'acc1',
  paidCalendarItemId: 'cal-paid',
  createdAt: '2026-07-05T12:00:00.000Z',
};

/**
 * The overnight bank-sync half — exactly what `bankEmailSync` writes. Its
 * descriptor shares ZERO significant tokens with the bill's title (CPENERGY /
 * MNGCO vs CENTERPOINT / ENERGY / NATURAL / GAS), which is the whole reason the
 * server-side matcher couldn't pair them — so this fixture is the AMOUNT-ONLY
 * tier unless a test gives it descriptor evidence.
 */
const bankRow: Transaction = {
  id: 'tx-bank',
  amount: 142,
  merchant: 'CPENERGY MNGCO 260805',
  category: 'Uncategorized',
  // Four days after the DUE date — the clearing lag the 7-day window exists for.
  date: '2026-07-09',
  status: 'verified',
  isRecurring: false,
  source: 'bank-sync',
  autoCategorized: false,
  accountId: 'acc1',
  needsCategory: true,
  bankRef: 'synth:cpenergy',
  createdAt: '2026-07-04T12:00:00.000Z',
};

const find = (
  candidate: Transaction,
  transactions: Transaction[] = [settledRow, candidate],
  calendarItems: CalendarItem[] = [template, paidInstance],
) => findSettledBillDuplicate(candidate, transactions, calendarItems);

describe('findSettledBillDuplicate', () => {
  it('matches the bank copy of a bill that was already paid by hand', () => {
    const match = find(bankRow);
    expect(match?.counterpart.id).toBe('tx-manual');
    expect(match?.bill.id).toBe('cal-paid');
  });

  it('is cent-exact — one cent apart is not a match', () => {
    expect(find({ ...bankRow, amount: 142.01 })).toBeUndefined();
  });

  it('compares SIGNED amounts — a -142 refund is not the +142 bill payment', () => {
    // Both rows are non-Income, so the polarity guard passes and an absolute
    // comparison would offer to MERGE (delete) the refund record. Every real
    // write path stores expenses positive, so this costs no true positives.
    expect(find({ ...bankRow, amount: -142 })).toBeUndefined();
    // …and symmetrically from the settled side.
    expect(find(bankRow, [{ ...settledRow, amount: -142 }, bankRow])).toBeUndefined();
  });

  it('matches at the window boundary and not one day past it', () => {
    expect(SETTLED_BILL_DUPLICATE_WINDOW_DAYS).toBe(7);
    // 2026-07-05 + 7 days.
    expect(find({ ...bankRow, date: '2026-07-12' })?.counterpart.id).toBe('tx-manual');
    // 8 days.
    expect(find({ ...bankRow, date: '2026-07-13' })).toBeUndefined();
    // The lag also runs the other way (bank posted before the bill's due date).
    expect(find({ ...bankRow, date: '2026-06-28' })?.counterpart.id).toBe('tx-manual');
    expect(find({ ...bankRow, date: '2026-06-27' })).toBeUndefined();
  });

  it('requires BOTH accounts to be present and equal', () => {
    expect(find({ ...bankRow, accountId: 'acc2' })).toBeUndefined();
    // An unknown account is NOT "no conflict": `buildMergeUpdates` would re-tag
    // the keeper to the bank's account while only the dupe's delta is reversed,
    // leaving the original account debited for money that moved elsewhere.
    expect(find({ ...bankRow, accountId: undefined })).toBeUndefined();
    // `settleBillWithTransaction` writes accountId only when one was requested,
    // so an untagged SETTLED row is an ordinary product of the link picker.
    expect(find(bankRow, [{ ...settledRow, accountId: undefined }, bankRow])).toBeUndefined();
  });

  it('rejects a counterpart whose bill is no longer actually paid', () => {
    // Reference dangles — the paid doc is gone.
    expect(find(bankRow, [settledRow, bankRow], [])).toBeUndefined();
    // Present but un-paid (payment undone on the calendar).
    expect(find(bankRow, [settledRow, bankRow], [{ ...paidInstance, isPaid: false }])).toBeUndefined();
    // Present but soft-deleted.
    expect(find(bankRow, [settledRow, bankRow], [{ ...paidInstance, isDeleted: true }])).toBeUndefined();
  });

  it('rejects a counterpart that already absorbed a bank copy (it carries a bankRef)', () => {
    // `buildMergeUpdates` inherits the dupe's bankRef onto the keeper, so this
    // is self-marking — and it is what stops a SECOND bank row being merged
    // into the same settled payment (pay by hand + autopay fires ⇒ two draws).
    expect(find(bankRow, [{ ...settledRow, bankRef: 'synth:already-merged' }, bankRow])).toBeUndefined();
  });

  it('rejects a candidate that is already linked to a bill of its own', () => {
    expect(find({ ...bankRow, paidCalendarItemId: 'cal-other' })).toBeUndefined();
  });

  it('rejects a candidate that is not a bank-sync row', () => {
    expect(find({ ...bankRow, source: 'manual', bankRef: undefined })).toBeUndefined();
    // `bankRef` alone still classifies it (isBankSyncTransaction's OR arm).
    expect(find({ ...bankRow, source: 'manual' })?.counterpart.id).toBe('tx-manual');
  });

  it('rejects a candidate that is not awaiting review', () => {
    // Verified with no needsCategory — already categorised, off every review surface.
    expect(find({ ...bankRow, needsCategory: undefined })).toBeUndefined();
    expect(find({ ...bankRow, needsCategory: false })).toBeUndefined();
    // A classic pending_review row still qualifies.
    expect(find({ ...bankRow, status: 'pending_review', needsCategory: undefined })?.counterpart.id).toBe('tx-manual');
  });

  describe('"Keep both" is scoped to the counterpart it was asked about', () => {
    it('suppresses that pairing', () => {
      expect(find({ ...bankRow, duplicateDismissedFor: 'tx-manual' })).toBeUndefined();
    });

    it('says nothing about a DIFFERENT settled bill', () => {
      // A dismissal of last month's pairing must not silence next month's.
      expect(find({ ...bankRow, duplicateDismissedFor: 'tx-some-other-payment' })?.counterpart.id).toBe('tx-manual');
    });
  });

  describe('ambiguity — under-merge rather than mis-merge, in BOTH directions', () => {
    it('returns nothing when TWO counterparts qualify for one bank row', () => {
      const secondSettled: Transaction = {
        ...settledRow,
        id: 'tx-manual-2',
        merchant: 'Water utility',
        paidCalendarItemId: 'cal-paid-2',
      };
      const secondPaid: CalendarItem = { ...paidInstance, id: 'cal-paid-2', title: 'Water utility', parentRecurringId: undefined };

      expect(
        find(bankRow, [settledRow, secondSettled, bankRow], [template, paidInstance, secondPaid]),
      ).toBeUndefined();
    });

    it('returns nothing when TWO bank rows qualify for one counterpart', () => {
      // The real scenario: the bill is paid by hand AND autopay fires, so the
      // bank draws twice. Merging either row away deletes a real charge.
      const secondBank: Transaction = { ...bankRow, id: 'tx-bank-2', bankRef: 'synth:cpenergy-2', date: '2026-07-08' };

      expect(find(bankRow, [settledRow, bankRow, secondBank])).toBeUndefined();
      // …and neither row gets it, whichever one is asked.
      expect(find(secondBank, [settledRow, bankRow, secondBank])).toBeUndefined();
    });

    it('ignores a rival bank row that does NOT itself qualify', () => {
      // Wrong account ⇒ not a rival, so the pairing stays unambiguous.
      const nonRival: Transaction = { ...bankRow, id: 'tx-bank-2', bankRef: 'synth:other', accountId: 'acc2' };
      expect(find(bankRow, [settledRow, bankRow, nonRival])?.counterpart.id).toBe('tx-manual');

      // Already reviewed ⇒ not a rival either.
      const reviewed: Transaction = { ...bankRow, id: 'tx-bank-3', bankRef: 'synth:other-2', needsCategory: false };
      expect(find(bankRow, [settledRow, bankRow, reviewed])?.counterpart.id).toBe('tx-manual');

      // A rival that already answered "keep both" about THIS counterpart has
      // taken itself out of the running.
      const dismissedRival: Transaction = {
        ...bankRow, id: 'tx-bank-4', bankRef: 'synth:other-3', duplicateDismissedFor: 'tx-manual',
      };
      expect(find(bankRow, [settledRow, bankRow, dismissedRival])?.counterpart.id).toBe('tx-manual');
    });
  });

  it('never matches income against expense', () => {
    expect(find({ ...bankRow, category: INCOME_CATEGORY })).toBeUndefined();
    expect(
      find(bankRow, [{ ...settledRow, category: INCOME_CATEGORY }, bankRow]),
    ).toBeUndefined();
    // Income on BOTH sides is internally consistent and still matches.
    expect(
      find(
        { ...bankRow, category: INCOME_CATEGORY },
        [{ ...settledRow, category: INCOME_CATEGORY }, { ...bankRow, category: INCOME_CATEGORY }],
      )?.counterpart.id,
    ).toBe('tx-manual');
  });

  it('never matches a row against itself', () => {
    const selfSettled = { ...bankRow, paidCalendarItemId: 'cal-paid' };
    expect(find(selfSettled, [selfSettled])).toBeUndefined();
  });

  it('ignores unparseable dates rather than throwing', () => {
    expect(find({ ...bankRow, date: 'not-a-date' })).toBeUndefined();
    expect(find(bankRow, [{ ...settledRow, date: 'not-a-date' }, bankRow])).toBeUndefined();
  });

  // The tier is what the UI keys its confidence off: `descriptor` asserts and
  // learns the alias, `amount-only` asks and learns nothing.
  describe('evidence tier', () => {
    it('is amount-only when the descriptor says nothing about the bill', () => {
      // CPENERGY / MNGCO vs CENTERPOINT / ENERGY / NATURAL / GAS — no overlap.
      expect(find(bankRow)?.evidence).toBe('amount-only');
    });

    it('is descriptor when the raw merchant shares a significant token with the title', () => {
      expect(find({ ...bankRow, merchant: 'CENTERPOINT ENGY 4471' })?.evidence).toBe('descriptor');
    });

    it('is descriptor when the raw merchant matches a learned alias on the TEMPLATE', () => {
      const learned: CalendarItem = { ...template, bankDescriptorAliases: ['cpenergy mngco 260805'] };
      expect(find(bankRow, [settledRow, bankRow], [learned, paidInstance])?.evidence).toBe('descriptor');
    });

    it('reads aliases off the paid doc itself for a ONE-OFF bill', () => {
      const oneOff: CalendarItem = {
        id: 'cal-oneoff', title: 'Dentist copay', amount: 142,
        date: '2026-07-05', type: 'expense', isPaid: true,
        bankDescriptorAliases: ['CPENERGY MNGCO 260805'],
      };
      const settledOneOff: Transaction = { ...settledRow, paidCalendarItemId: 'cal-oneoff' };
      expect(find(bankRow, [settledOneOff, bankRow], [oneOff])?.evidence).toBe('descriptor');
    });

    it('ignores an alias on a template that no longer exists — the paid doc has none', () => {
      // The template was deleted; its aliases went with it, so there is no
      // descriptor evidence left to read.
      expect(find(bankRow, [settledRow, bankRow], [paidInstance])?.evidence).toBe('amount-only');
    });
  });
});

describe('aliasTargetForSettledRow', () => {
  it('resolves a paid INSTANCE to its recurring template — never the one-shot doc', () => {
    expect(aliasTargetForSettledRow(settledRow, [template, paidInstance])).toBe('cal-tmpl');
  });

  it('resolves a one-off bill to its own id', () => {
    const oneOff: CalendarItem = {
      id: 'cal-oneoff', title: 'Dentist copay', amount: 85,
      date: '2026-07-05', type: 'expense', isPaid: true,
    };
    expect(
      aliasTargetForSettledRow({ paidCalendarItemId: 'cal-oneoff' }, [oneOff]),
    ).toBe('cal-oneoff');
  });

  it('falls back to the paid instance when its TEMPLATE has been deleted', () => {
    // `makeDeleteCalendarItem` hard-deletes a template and orphans its paid
    // instances, so `parentRecurringId` really can dangle. Returning it anyway
    // made `mergeBatch.update()` reject the WHOLE batch with `not-found` —
    // keeper patch and dupe delete included — so Merge failed forever.
    expect(aliasTargetForSettledRow(settledRow, [paidInstance])).toBe('cal-paid');
  });

  it('returns NOTHING when the paid doc itself cannot be found', () => {
    // Nothing to write to: the caller merges without learning anything.
    expect(aliasTargetForSettledRow(settledRow, [])).toBeUndefined();
  });

  it('returns nothing for a row that settled no bill', () => {
    expect(aliasTargetForSettledRow({ paidCalendarItemId: undefined }, [paidInstance])).toBeUndefined();
  });
});
