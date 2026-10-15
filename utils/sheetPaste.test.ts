import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { Account, BudgetBucket, CalendarItem, HalfPlan } from '@/types/schema';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { applyOthers, guessOtherTarget, matchBills, parseSheetPaste } from '@/utils/sheetPaste';
import { OCTOBER_SHEET_PASTE as OCTOBER } from '@/utils/sheetPaste.fixture';



const sum = (ns: number[]) => Math.round(ns.reduce((a, b) => a + b, 0) * 100) / 100;

describe('parseSheetPaste — the October sheet', () => {
  const parsed = parseSheetPaste(OCTOBER);
  const half = (p: 0 | 1) => parsed.bills.filter(b => b.panel === p);

  it('reads every dated bill on its day, and no paychecks or totals', () => {
    expect(half(0)).toHaveLength(15);
    expect(half(1)).toHaveLength(16);
    expect(sum(half(0).map(b => b.amount))).toBe(4485.89);
    expect(sum(half(1).map(b => b.amount))).toBe(3292.43);
    expect(half(0).find(b => b.title === 'Xcel')).toEqual({ panel: 0, day: 1, title: 'Xcel', amount: 133.53 });
    expect(half(1).find(b => b.title === 'Fidelity')?.day).toBe(16);
    expect(half(1).find(b => b.title === 'Centerpoint')?.day).toBe(26);
    expect(parsed.bills.some(b => /paycheck|total|remainder/i.test(b.title))).toBe(false);
  });

  it('reads the Other Expenses that have amounts, ignoring the Actual columns', () => {
    expect(parsed.others).toEqual([
      { panel: 0, label: 'Gas', amount: 120 },
      { panel: 0, label: 'Grocery/Misc', amount: 850 },
      { panel: 0, label: 'AmEx', amount: 700 },
      { panel: 1, label: 'Gas', amount: 110 },
      { panel: 1, label: 'Grocery/Misc', amount: 850 },
      { panel: 1, label: 'Childcare', amount: 400 },
      { panel: 1, label: 'Leftover to savings', amount: 900 },
    ]);
  });

  it('works without the header row', () => {
    const noHeader = OCTOBER.split('\n').slice(1).join('\n');
    expect(parseSheetPaste(noHeader).bills).toHaveLength(31);
  });
});

describe('guessOtherTarget', () => {
  const buckets: BudgetBucket[] = [
    { id: 'gas', name: 'Gas', limit: 0, color: 'orange', isVariable: true, isCore: true },
    { id: 'groc', name: 'Groceries', limit: 0, color: 'green', isVariable: true, isCore: true },
  ];
  const accounts: Account[] = [
    { id: 'amex', name: 'American Express', type: 'credit', balance: 0, lastUpdated: '' },
  ];

  it('finds the budget, the card and the savings line', () => {
    expect(guessOtherTarget('Gas', buckets, accounts)).toEqual({ kind: 'bucket', bucketId: 'gas' });
    expect(guessOtherTarget('Grocery/Misc', buckets, accounts)).toEqual({ kind: 'bucket', bucketId: 'groc' });
    expect(guessOtherTarget('AmEx', buckets, accounts)).toEqual({ kind: 'allocation', allocation: 'card-extra', accountId: 'amex' });
    expect(guessOtherTarget('Leftover to savings', buckets, accounts)).toEqual({ kind: 'allocation', allocation: 'to-savings' });
    expect(guessOtherTarget('Childcare', buckets, accounts)).toEqual({ kind: 'allocation', allocation: 'other' });
  });
});

describe('matchBills', () => {
  const mortgage: CalendarItem = {
    id: 'mortgage', title: 'Mortgage', amount: 2166, date: '2026-01-01', type: 'expense', isPaid: false,
    isRecurring: true, frequency: 'monthly',
  };
  const parkway: CalendarItem = {
    id: 'parkway', title: 'Parkway', amount: 80, date: '2026-01-07', type: 'expense', isPaid: false,
    isRecurring: true, frequency: 'weekly',
  };
  const xcelPaid: CalendarItem = {
    id: 'xcel-paid', title: 'XCEL', amount: 140, date: '2026-10-01', type: 'expense', isPaid: true,
  };
  const expanded = expandCalendarItems([mortgage, parkway, xcelPaid], parseISO('2026-09-28'), parseISO('2026-11-03'));
  const matches = matchBills(parseSheetPaste(OCTOBER).bills, '2026-10', expanded);
  const byTitle = (title: string) => matches.filter(m => m.bill.title === title);

  it('matches what the app already has by name and nearby date, so nothing is added twice', () => {
    expect(byTitle('Mortgage')[0]?.existing?.id).toBe('mortgage_instance_2026-10-01');
    expect(byTitle('Xcel')[0]?.existing?.id).toBe('xcel-paid');
    // The 28th's Xcel has nothing within 3 days, so it is new.
    expect(byTitle('Xcel')[1]?.existing).toBeUndefined();
  });

  it('lines up each repeat of a bill with its own occurrence', () => {
    // The sheet's Parkway days (1, 7, 14, 19, 26) against a weekly Wednesday series.
    expect(byTitle('Parkway').map(m => m.existing?.date)).toEqual([
      '2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
    ]);
  });

  it('marks the rest as new, dated in the month', () => {
    const jenHair = byTitle('Jen Hair')[0];
    expect(jenHair?.existing).toBeUndefined();
    expect(jenHair?.date).toBe('2026-10-05');
  });
});

describe('applyOthers', () => {
  it('sets budgets and updates or adds allocation lines, leaving done lines alone', () => {
    const plan: HalfPlan = {
      id: '2026-10-16',
      budgets: { gas: 90 },
      allocations: [
        { id: 'a', kind: 'to-savings', label: 'Leftover to savings', amount: 500 },
        { id: 'b', kind: 'card-extra', label: 'AmEx', amount: 300, done: true },
      ],
    };
    const next = applyOthers(
      plan,
      [
        { label: 'Gas', amount: 110, target: { kind: 'bucket', bucketId: 'gas' } },
        { label: 'Leftover to savings', amount: 900, target: { kind: 'allocation', allocation: 'to-savings' } },
        { label: 'AmEx', amount: 700, target: { kind: 'allocation', allocation: 'card-extra' } },
        { label: 'Childcare', amount: 400, target: { kind: 'skip' } },
      ],
      () => 'new'
    );
    expect(next.budgets).toEqual({ gas: 110 });
    expect(next.allocations).toEqual([
      { id: 'a', kind: 'to-savings', label: 'Leftover to savings', amount: 900 },
      { id: 'b', kind: 'card-extra', label: 'AmEx', amount: 300, done: true },
    ]);
  });
});
