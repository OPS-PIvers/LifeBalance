import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { Account, CalendarItem, HalfAllocation, HalfPlan } from '@/types/schema';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { buildPayHalves, findHalfContaining, nominalPaydayOf } from '@/utils/payPeriodHalves';
import { allocationTransfer, isFullyAssigned, seedHalfPlan, summarizeHalf } from '@/utils/halfPlan';

// The household's real October 2026 sheet: two paychecks on the 1st and 16th
// (paid the Friday before a weekend), and their dated bills.
const paycheck = (id: string, earnerId: string): CalendarItem => ({
  id,
  title: 'Paycheck',
  amount: 2851.5,
  date: '2026-01-01',
  type: 'income',
  isPaid: false,
  isRecurring: true,
  frequency: 'semi-monthly',
  semiMonthlyDays: [1, 16],
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
const expanded = expandCalendarItems(raw, parseISO('2026-09-25'), parseISO('2026-11-30'));
const halves = buildPayHalves(expanded, raw);
const BUCKETS = new Set(['gas', 'grocery', 'childcare']);

const half = (id: string) => {
  const h = halves.find(x => x.id === id);
  if (!h?.end) throw new Error(`no closed half ${id}`);
  return { start: h.start, end: h.end };
};

describe('buildPayHalves', () => {
  it('opens one half per payday, even with two earners', () => {
    expect(halves.map(h => [h.id, h.start, h.end])).toEqual([
      ['2026-10-01', '2026-10-01', '2026-10-15'],
      ['2026-10-16', '2026-10-16', '2026-10-29'],
      // Sun Nov 1 is paid Fri Oct 30, so November's first half starts then.
      ['2026-11-01', '2026-10-30', '2026-11-15'],
      ['2026-11-16', '2026-11-16', null],
    ]);
  });

  it('keeps a half\'s id when its paycheck has been paid', () => {
    const paid: CalendarItem = {
      id: 'paid-nov1',
      title: 'Paycheck',
      amount: 2851.5,
      date: '2026-10-30',
      type: 'income',
      isPaid: true,
      isRecurring: false,
      parentRecurringId: 'pay-paul',
    };
    const templates = new Map(raw.map(i => [i.id, i]));
    expect(nominalPaydayOf(paid, templates)).toBe('2026-11-01');
    const withPaid = buildPayHalves(expandCalendarItems([...raw, paid], parseISO('2026-10-20'), parseISO('2026-11-30')), [...raw, paid]);
    expect(withPaid.find(h => h.id === '2026-11-01')?.start).toBe('2026-10-30');
  });

  it('ignores one-off income when splitting halves', () => {
    const bonus: CalendarItem = { id: 'bonus', title: 'Bonus', amount: 500, date: '2026-10-08', type: 'income', isPaid: false };
    const withBonus = buildPayHalves(expandCalendarItems([...raw, bonus], parseISO('2026-10-01'), parseISO('2026-10-31')), [...raw, bonus]);
    expect(withBonus.map(h => h.id)).toEqual(['2026-10-01', '2026-10-16', '2026-11-01']);
  });

  it('finds the half a date falls in', () => {
    expect(findHalfContaining(halves, '2026-10-15')?.id).toBe('2026-10-01');
    expect(findHalfContaining(halves, '2026-10-31')?.id).toBe('2026-11-01');
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
      { id: 'a1', kind: 'card-extra', label: 'AmEx extra payment', amount: 700, done: true },
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
