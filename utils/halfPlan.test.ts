import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { Account, CalendarItem, HalfAllocation, HalfPlan, Transaction } from '@/types/schema';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { fundedHalfId, halfOf, halvesBetween } from '@/utils/payPeriodHalves';
import {
  allocationToggle,
  allocationTransfer,
  withAllocationDone,
  balancingPlan,
  dueDays,
  halfBucketActuals,
  isFullyAssigned,
  overrunFixes,
  seedHalfPlan,
  summarizeHalf,
} from '@/utils/halfPlan';

// The household's real October 2026 sheet: two paychecks paid the 15th and
// the last day (the Friday before a weekend), and the month's dated bills.
const paycheck = (id: string, earnerId: string): CalendarItem => ({
  id,
  title: 'Paycheck',
  amount: 2851.5,
  date: '2026-01-01',
  type: 'income',
  isPaid: false,
  isRecurring: true,
  frequency: 'semi-monthly',
  semiMonthlyDays: [15, 31],
  weekendShift: 'before',
  earnerId,
});

const BILLS: [number, string, number][] = [
  [1, 'Mortgage', 2166], [1, 'Xcel', 133.53], [1, 'Jen Car', 639], [1, 'Jen tabs', 602],
  [1, 'Jen Visa Minimum', 72], [1, 'Parkway', 80], [1, 'AT&T', 143.8], [1, 'Haferman Water', 36.56],
  [1, 'Manny Meds', 108], [2, 'Stella bday gift', 40], [3, 'Auto-Owners Life', 83], [5, 'Jen Hair', 200],
  [7, 'Parkway', 80], [13, 'Spotify Premium', 22], [14, 'Parkway', 80],
  [16, 'Heloc', 400], [16, 'Paul Car', 498], [16, 'Paul Visa Min', 50], [16, 'Ferry Ride', 160],
  [16, 'Fidelity', 100], [16, 'Easton 529', 50], [17, 'Comcast', 158], [18, 'American Express', 735],
  [19, 'Auto-Owners Car/Home', 225], [19, 'Camp Bow Wow', 300], [19, 'Airport Parking', 100], [19, 'Parkway', 80],
  [23, 'Paul Hockey', 219], [26, 'Parkway', 80], [26, 'Centerpoint', 38.75], [28, 'Xcel', 98.68],
];

const bills: CalendarItem[] = BILLS.map(([day, title, amount], i) => ({
  id: `bill-${i}`,
  title,
  amount,
  date: `2026-10-${String(day).padStart(2, '0')}`,
  type: 'expense',
  isPaid: false,
}));

const raw = [paycheck('pay-paul', 'paul'), paycheck('pay-jen', 'jen'), ...bills];
const expanded = expandCalendarItems(raw, parseISO('2026-09-20'), parseISO('2026-11-30'));
const BUCKETS = new Set(['gas', 'grocery', 'childcare']);
const half = (id: string) => halfOf(id);

describe('halves', () => {
  it('are the 1st–15th and the 16th–last day of each month', () => {
    expect(halvesBetween('2026-10', '2026-11').map(h => [h.id, h.start, h.end])).toEqual([
      ['2026-10-01', '2026-10-01', '2026-10-15'],
      ['2026-10-16', '2026-10-16', '2026-10-31'],
      ['2026-11-01', '2026-11-01', '2026-11-15'],
      ['2026-11-16', '2026-11-16', '2026-11-30'],
    ]);
    expect(halfOf('2026-10-15').id).toBe('2026-10-01');
    expect(halfOf('2026-02-20').end).toBe('2026-02-28');
  });

  it('a paycheck funds the half it lands closest to the start of', () => {
    // Paid at the end of a month, it pays for the next month's first half.
    expect(fundedHalfId('2026-09-27')).toBe('2026-10-01');
    expect(fundedHalfId('2026-09-30')).toBe('2026-10-01');
    expect(fundedHalfId('2026-10-01')).toBe('2026-10-01');
    // Paid around the 15th, it pays for the 16th–end.
    expect(fundedHalfId('2026-10-13')).toBe('2026-10-16');
    expect(fundedHalfId('2026-10-15')).toBe('2026-10-16');
    expect(fundedHalfId('2026-10-16')).toBe('2026-10-16');
    // Across a year end.
    expect(fundedHalfId('2026-12-29')).toBe('2027-01-01');
  });

  it("counts each paycheck in the half it funds, wherever it lands", () => {
    const paychecks = (id: string) =>
      summarizeHalf(half(id), expanded, undefined, BUCKETS).paychecks.map(p => p.date);
    // Paid the 15th and the last day, the Friday before a weekend.
    expect(paychecks('2026-10-01')).toEqual(['2026-09-30', '2026-09-30']);
    expect(paychecks('2026-10-16')).toEqual(['2026-10-15', '2026-10-15']);
    // Sat Oct 31 is paid Fri Oct 30: still November's first half.
    expect(paychecks('2026-11-01')).toEqual(['2026-10-30', '2026-10-30']);
  });
});

describe('summarizeHalf — the October sheet', () => {
  const firstHalf: HalfPlan = {
    id: '2026-10-01',
    budgets: { gas: 120, grocery: 850 },
    allocations: [{ id: 'a1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700 }],
  };

  it('reproduces the 1st half: $452.89 short', () => {
    const s = summarizeHalf(half('2026-10-01'), expanded, firstHalf, BUCKETS);
    expect(s.paycheckTotal).toBe(5703);
    expect(s.billTotal).toBe(4485.89);
    expect(s.budgetTotal).toBe(970);
    expect(s.allocationsOut).toBe(700);
    expect(s.leftToAssign).toBe(-452.89);
    expect(isFullyAssigned(s)).toBe(false);
  });

  it('reaches $0 once the shortfall is covered from savings', () => {
    const covered: HalfPlan = {
      ...firstHalf,
      allocations: [...firstHalf.allocations, { id: 'a2', kind: 'from-savings', label: 'From savings', amount: 452.89 }],
    };
    const s = summarizeHalf(half('2026-10-01'), expanded, covered, BUCKETS);
    expect(s.fromSavings).toBe(452.89);
    expect(s.leftToAssign).toBe(0);
    expect(isFullyAssigned(s)).toBe(true);
  });

  it('reproduces the 2nd half: $150.57 with no job yet', () => {
    const plan: HalfPlan = {
      id: '2026-10-16',
      budgets: { gas: 110, grocery: 850, childcare: 400 },
      allocations: [{ id: 'b1', kind: 'to-savings', label: 'To savings', amount: 900 }],
    };
    const s = summarizeHalf(half('2026-10-16'), expanded, plan, BUCKETS);
    expect(s.billTotal).toBe(3292.43);
    expect(s.leftToAssign).toBe(150.57);
  });

  it('counts a paid bill at what was actually paid', () => {
    const xcelPaid: CalendarItem = { ...bills[1]!, id: 'bill-1', amount: 98.68, isPaid: true };
    const withPaid = expanded.map(i => (i.id === 'bill-1' ? xcelPaid : i));
    const s = summarizeHalf(half('2026-10-01'), withPaid, firstHalf, BUCKETS);
    expect(s.billTotal).toBe(4451.04);
  });

  it('ignores planned amounts for buckets that no longer exist', () => {
    const plan: HalfPlan = { ...firstHalf, budgets: { gas: 120, grocery: 850, deleted: 999 } };
    expect(summarizeHalf(half('2026-10-01'), expanded, plan, BUCKETS).budgetTotal).toBe(970);
  });

  it('with no plan, the paycheck minus bills is left to assign', () => {
    expect(summarizeHalf(half('2026-10-01'), expanded, undefined, BUCKETS).leftToAssign).toBe(1217.11);
  });
});

describe('seedHalfPlan', () => {
  let n = 0;
  const newId = () => `new-${++n}`;
  const october1: HalfPlan = {
    id: '2026-10-01',
    budgets: { gas: 120, grocery: 850 },
    allocations: [
      { id: 'a1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700, done: true, moved: { chk: -700, amex: -700 } },
      { id: 'a2', kind: 'from-savings', label: 'From savings', amount: 452.89, done: true },
    ],
  };
  const october16: HalfPlan = {
    id: '2026-10-16',
    budgets: { gas: 110, grocery: 850, childcare: 400 },
    allocations: [{ id: 'b1', kind: 'to-savings', label: 'To savings', amount: 900 }],
  };

  it('copies the same half last month, unchecked, without last month\'s savings cover', () => {
    const seeded = seedHalfPlan('2026-11-01', [october16, october1], newId);
    expect(seeded.id).toBe('2026-11-01');
    expect(seeded.budgets).toEqual({ gas: 120, grocery: 850 });
    expect(seeded.allocations).toEqual([
      { id: 'new-1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700 },
    ]);
  });

  it('falls back to the most recent earlier plan', () => {
    expect(seedHalfPlan('2026-12-16', [october1, october16], newId).budgets).toEqual(october16.budgets);
  });

  it('starts empty when nothing earlier exists', () => {
    expect(seedHalfPlan('2026-09-16', [october1], newId)).toEqual({ id: '2026-09-16', budgets: {}, allocations: [] });
  });
});

describe('allocationTransfer', () => {
  const acct = (id: string, type: Account['type'], extra: Partial<Account> = {}): Account =>
    ({ id, name: id, type, balance: 0, lastUpdated: '', ...extra });
  const accounts = [acct('chk', 'checking'), acct('sav', 'savings'), acct('amex', 'credit')];
  const line = (kind: HalfAllocation['kind'], accountId?: string): HalfAllocation =>
    ({ id: 'a', kind, label: kind, amount: 900, accountId });

  it('moves checking to savings, and back when unchecked', () => {
    expect(allocationTransfer(line('to-savings'), accounts, undefined, true)).toEqual({ kind: 'move', deltas: { chk: -900, sav: 900 } });
    expect(allocationTransfer(line('to-savings'), accounts, undefined, false)).toEqual({ kind: 'move', deltas: { chk: 900, sav: -900 } });
  });

  it('covers a short half from savings', () => {
    expect(allocationTransfer(line('from-savings'), accounts, undefined, true)).toEqual({ kind: 'move', deltas: { sav: -900, chk: 900 } });
  });

  it('pays extra on a card: checking and the card debt both drop', () => {
    expect(allocationTransfer(line('card-extra', 'amex'), accounts, undefined, true)).toEqual({ kind: 'move', deltas: { chk: -900, amex: -900 } });
    expect(allocationTransfer(line('card-extra'), accounts, undefined, true)).toMatchObject({ kind: 'missing' });
  });

  it('uses the default checking account and skips archived ones', () => {
    const more = [acct('old', 'checking', { archived: true, order: 0 }), acct('chk2', 'checking', { order: 1 }), acct('chk', 'checking', { order: 2 }), ...accounts.slice(1)];
    expect(allocationTransfer(line('to-savings'), more, 'chk', true)).toMatchObject({ deltas: { chk: -900 } });
    expect(allocationTransfer(line('to-savings'), more, undefined, true)).toMatchObject({ deltas: { chk2: -900 } });
  });

  it('moves nothing for an "other" line, and says what is missing', () => {
    expect(allocationTransfer(line('other'), accounts, undefined, true)).toEqual({ kind: 'none' });
    expect(allocationTransfer(line('to-savings'), [acct('chk', 'checking')], undefined, true)).toEqual({ kind: 'missing', reason: 'Add a savings account first' });
  });
});

describe('allocationToggle — unchecking reverses exactly what the check moved', () => {
  const acct = (id: string, type: Account['type'], extra: Partial<Account> = {}): Account =>
    ({ id, name: id, type, balance: 0, lastUpdated: '', ...extra });
  const accounts = [acct('chk', 'checking'), acct('sav', 'savings'), acct('amex', 'credit'), acct('visa', 'credit')];
  const done = (kind: HalfAllocation['kind'], moved: Record<string, number>, accountId?: string): HalfAllocation =>
    ({ id: 'a', kind, label: kind, amount: 900, accountId, done: true, moved });

  it('checking computes the transfer as before', () => {
    const line: HalfAllocation = { id: 'a', kind: 'to-savings', label: 'x', amount: 900 };
    expect(allocationToggle(line, accounts, undefined, true)).toEqual({ kind: 'move', deltas: { chk: -900, sav: 900 } });
  });

  it('undoes the recorded move even after the default account and account order changed', () => {
    const now = [acct('chk2', 'checking', { order: 0 }), acct('sav2', 'savings', { order: 0 }), ...accounts.map(a => ({ ...a, order: 5 }))];
    expect(allocationToggle(done('to-savings', { chk: -900, sav: 900 }), now, 'chk2', false))
      .toEqual({ kind: 'move', deltas: { chk: 900, sav: -900 } });
  });

  it('undoes a card payment on the card it was made to, after the line\'s card was changed', () => {
    expect(allocationToggle(done('card-extra', { chk: -900, amex: -900 }, 'visa'), accounts, undefined, false))
      .toEqual({ kind: 'move', deltas: { chk: 900, amex: 900 } });
  });

  it('still undoes when the card has since been archived', () => {
    const archived = accounts.map(a => (a.id === 'amex' ? { ...a, archived: true } : a));
    expect(allocationToggle(done('card-extra', { chk: -900, amex: -900 }, 'amex'), archived, undefined, false))
      .toEqual({ kind: 'move', deltas: { chk: 900, amex: 900 } });
  });

  it('skips an account that no longer exists rather than failing the whole undo', () => {
    expect(allocationToggle(done('to-savings', { chk: -900, gone: 900 }), accounts, undefined, false))
      .toEqual({ kind: 'move', deltas: { chk: 900 } });
    expect(allocationToggle(done('to-savings', { gone: 900 }), accounts, undefined, false)).toEqual({ kind: 'none' });
  });

  it('recomputes for a line checked before the record existed', () => {
    const legacy: HalfAllocation = { id: 'a', kind: 'to-savings', label: 'x', amount: 900, done: true };
    expect(allocationToggle(legacy, accounts, undefined, false)).toEqual({ kind: 'move', deltas: { chk: 900, sav: -900 } });
  });
});

describe('withAllocationDone', () => {
  const line: HalfAllocation = { id: 'a', kind: 'to-savings', label: 'x', amount: 900 };
  it('records the move on check and clears it on uncheck', () => {
    const checked = withAllocationDone(line, true, { kind: 'move', deltas: { chk: -900, sav: 900 } });
    expect(checked).toEqual({ ...line, done: true, moved: { chk: -900, sav: 900 } });
    expect(withAllocationDone(checked, false, { kind: 'move', deltas: { chk: 900, sav: -900 } })).toEqual(line);
    expect(withAllocationDone(line, true, { kind: 'none' })).toEqual({ ...line, done: true });
  });
});

describe('dueDays and balancingPlan', () => {
  const plan: HalfPlan = {
    id: '2026-10-01',
    budgets: { gas: 120, grocery: 850 },
    allocations: [{ id: 'a1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700 }],
  };
  const summary = summarizeHalf(half('2026-10-01'), expanded, plan, BUCKETS);

  it('lists only the days that have bills, in order', () => {
    const days = dueDays(summary);
    expect(days.map(d => d.date)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-13', '2026-10-14']);
    expect(days[0]?.bills).toHaveLength(9);
  });

  it('covers a short half from savings, landing on $0', () => {
    const balanced = balancingPlan(plan, summary, () => 'n1');
    expect(balanced?.allocations.at(-1)).toEqual({ id: 'n1', kind: 'from-savings', label: 'From savings', amount: 452.89 });
    expect(balanced && summarizeHalf(half('2026-10-01'), expanded, balanced, BUCKETS).leftToAssign).toBe(0);
  });

  it('grows an existing unchecked line instead of adding another', () => {
    const extra: HalfPlan = { ...plan, allocations: [...plan.allocations, { id: 's', kind: 'to-savings', label: 'Leftover to savings', amount: 100 }] };
    const noPlan = summarizeHalf(half('2026-10-01'), expanded, { ...extra, budgets: {}, allocations: [extra.allocations[1]!] }, BUCKETS);
    const balanced = balancingPlan(extra, noPlan, () => 'n2');
    expect(balanced?.allocations.find(a => a.id === 's')?.amount).toBe(1217.11);
    expect(balanced?.allocations).toHaveLength(2);
  });

  it('does nothing for a fully assigned half', () => {
    expect(balancingPlan(plan, { ...summary, leftToAssign: 0 }, () => 'x')).toBeNull();
  });
});

describe('half actuals and overrun fixes', () => {
  const buckets = [
    { id: 'gas', name: 'Gas', limit: 0, color: 'orange', isVariable: true, isCore: true },
    { id: 'grocery', name: 'Groceries', limit: 0, color: 'green', isVariable: true, isCore: true },
  ];
  const tx = (date: string, category: string, amount: number) =>
    ({ id: `${date}-${category}-${amount}`, date, category, amount, merchant: 'x', status: 'verified' }) as Transaction;
  const transactions = [
    tx('2026-10-02', 'Gas', 80),
    tx('2026-10-09', 'gas', 70.5),
    tx('2026-10-20', 'Gas', 999), // next half
    tx('2026-10-03', 'Groceries', 300),
    tx('2026-10-04', 'Income', 5000),
    tx('2026-10-05', 'Credit Card', 400),
  ];
  const actuals = halfBucketActuals(buckets, transactions, { start: '2026-10-01', end: '2026-10-15' });
  const plan: HalfPlan = { id: '2026-10-01', budgets: { gas: 120, grocery: 850 }, allocations: [] };

  it('sums each bucket\'s spending inside the half only', () => {
    expect(Object.fromEntries(actuals)).toEqual({ gas: 150.5, grocery: 300 });
  });

  it('offers savings, or a budget with room, and either keeps the half as assigned', () => {
    const fixes = overrunFixes(plan, 'gas', actuals, () => 'n', BUCKETS);
    expect(fixes.map(f => [f.kind, f.fromBucketId])).toEqual([['savings', undefined], ['bucket', 'grocery']]);
    expect(fixes[0]?.plan.budgets.gas).toBe(150.5);
    expect(fixes[0]?.plan.allocations).toEqual([{ id: 'n', kind: 'from-savings', label: 'From savings', amount: 30.5 }]);
    expect(fixes[1]?.plan.budgets).toEqual({ gas: 150.5, grocery: 819.5 });
    const before = summarizeHalf(half('2026-10-01'), expanded, plan, BUCKETS).leftToAssign;
    for (const fix of fixes) {
      expect(summarizeHalf(half('2026-10-01'), expanded, fix.plan, BUCKETS).leftToAssign).toBe(before);
    }
  });

  it('never offers to take from a budget that no longer exists', () => {
    const withGhost: HalfPlan = { ...plan, budgets: { gas: 120, grocery: 800, ghost: 900 } };
    const fixes = overrunFixes(withGhost, 'gas', actuals, () => 'n', BUCKETS);
    expect(fixes.map(f => f.fromBucketId)).not.toContain('ghost');
    expect(fixes.map(f => [f.kind, f.fromBucketId])).toEqual([['savings', undefined], ['bucket', 'grocery']]);
    const before = summarizeHalf(half('2026-10-01'), expanded, withGhost, BUCKETS).leftToAssign;
    for (const fix of fixes) {
      expect(summarizeHalf(half('2026-10-01'), expanded, fix.plan, BUCKETS).leftToAssign).toBe(before);
    }
  });

  it('offers nothing for a budget that has not run over', () => {
    expect(overrunFixes(plan, 'grocery', actuals, () => 'n', BUCKETS)).toEqual([]);
  });
});
