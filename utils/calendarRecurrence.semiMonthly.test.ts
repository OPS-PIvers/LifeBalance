import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import {
  expandCalendarItems,
  generateRecurringInstances,
  rollRecurringAnchorForward,
  semiMonthlyDaysFor,
  shiftForWeekend,
} from './calendarRecurrence';
import { CalendarItem } from '@/types/schema';

const paycheck: CalendarItem = {
  id: 'pay',
  title: 'Paycheck',
  amount: 5703,
  date: '2026-01-01',
  type: 'income',
  isPaid: false,
  isRecurring: true,
  frequency: 'semi-monthly',
  semiMonthlyDays: [1, 16],
};

const datesOf = (item: CalendarItem, start: string, end: string) =>
  generateRecurringInstances(item, parseISO(start), parseISO(end)).map(i => i.date);

describe('semi-monthly recurrence', () => {
  it('falls on both days of every month', () => {
    expect(datesOf(paycheck, '2026-10-01', '2026-12-31')).toEqual([
      '2026-10-01', '2026-10-16', '2026-11-01', '2026-11-16', '2026-12-01', '2026-12-16',
    ]);
  });

  it('gives each occurrence its own synthetic id', () => {
    const [first] = generateRecurringInstances(paycheck, parseISO('2026-10-01'), parseISO('2026-10-01'));
    expect(first?.id).toBe('pay_instance_2026-10-01');
  });

  it('never produces dates before the anchor', () => {
    expect(datesOf({ ...paycheck, date: '2026-10-16' }, '2026-10-01', '2026-11-05')).toEqual([
      '2026-10-16', '2026-11-01',
    ]);
  });

  it('clamps a day past the month end to the last day', () => {
    const item = { ...paycheck, semiMonthlyDays: [15, 31] };
    expect(datesOf(item, '2026-02-01', '2026-04-30')).toEqual([
      '2026-02-15', '2026-02-28', '2026-03-15', '2026-03-31', '2026-04-15', '2026-04-30',
    ]);
  });

  it('derives the day pair from the anchor when none is stored', () => {
    expect(semiMonthlyDaysFor({ date: '2026-01-01' })).toEqual([1, 16]);
    expect(semiMonthlyDaysFor({ date: '2026-01-15' })).toEqual([15, 30]);
    expect(semiMonthlyDaysFor({ date: '2026-01-20' })).toEqual([5, 20]);
    expect(semiMonthlyDaysFor({ date: '2026-01-31' })).toEqual([16, 31]);
  });

  it('sorts a stored pair and ignores an invalid one', () => {
    expect(semiMonthlyDaysFor({ date: '2026-01-01', semiMonthlyDays: [16, 1] })).toEqual([1, 16]);
    expect(semiMonthlyDaysFor({ date: '2026-01-01', semiMonthlyDays: [5, 5] })).toEqual([1, 16]);
    expect(semiMonthlyDaysFor({ date: '2026-01-01', semiMonthlyDays: [0, 40] })).toEqual([1, 16]);
  });
});

describe('weekend shift', () => {
  const friday = { ...paycheck, weekendShift: 'before' as const };

  it('moves Saturday and Sunday to the Friday before or Monday after', () => {
    const fmt = (d: Date) => d.toDateString();
    expect(fmt(shiftForWeekend(parseISO('2026-08-01'), 'before'))).toBe(fmt(parseISO('2026-07-31')));
    expect(fmt(shiftForWeekend(parseISO('2026-11-01'), 'before'))).toBe(fmt(parseISO('2026-10-30')));
    expect(fmt(shiftForWeekend(parseISO('2026-08-01'), 'after'))).toBe(fmt(parseISO('2026-08-03')));
    expect(fmt(shiftForWeekend(parseISO('2026-11-01'), 'after'))).toBe(fmt(parseISO('2026-11-02')));
    expect(fmt(shiftForWeekend(parseISO('2026-10-16'), 'before'))).toBe(fmt(parseISO('2026-10-16')));
  });

  it('pulls a Sunday Nov 1 paycheck into the October window, keeping its nominal date', () => {
    const october = generateRecurringInstances(friday, parseISO('2026-10-01'), parseISO('2026-10-31'));
    expect(october.map(i => [i.date, i.nominalDate])).toEqual([
      ['2026-10-01', undefined],
      ['2026-10-16', undefined],
      ['2026-10-30', '2026-11-01'],
    ]);
    expect(october[2]?.id).toBe('pay_instance_2026-10-30');
  });

  it('leaves the shifted occurrence out of the window it moved away from', () => {
    expect(datesOf(friday, '2026-11-01', '2026-11-30')).toEqual(['2026-11-16']);
  });

  it('shifts a monthly series too', () => {
    const rent = { ...paycheck, frequency: 'monthly' as const, semiMonthlyDays: undefined, weekendShift: 'after' as const };
    expect(datesOf(rent, '2026-01-01', '2026-03-31')).toEqual(['2026-01-01', '2026-02-02', '2026-03-02']);
  });

  it('keeps one occurrence when both days shift onto the same Friday', () => {
    const item = { ...friday, semiMonthlyDays: [15, 16] };
    // Aug 15 2026 is a Saturday and Aug 16 a Sunday: both move to Fri Aug 14.
    expect(datesOf(item, '2026-08-01', '2026-08-31')).toEqual(['2026-08-14']);
  });

  it('suppresses a paid occurrence by its shifted date', () => {
    const paid: CalendarItem = {
      ...paycheck,
      id: 'paid-1',
      date: '2026-10-30',
      isPaid: true,
      isRecurring: false,
      frequency: undefined,
      parentRecurringId: 'pay',
    };
    const expanded = expandCalendarItems([friday, paid], parseISO('2026-10-01'), parseISO('2026-10-31'));
    expect(expanded.map(i => [i.id, i.isPaid])).toEqual([
      ['pay_instance_2026-10-01', false],
      ['pay_instance_2026-10-16', false],
      ['paid-1', true],
    ]);
  });
});

describe('rollRecurringAnchorForward with a schedule', () => {
  const schedule = { semiMonthlyDays: [1, 16], weekendShift: 'before' as const };

  it('anchors on the next occurrence whose paid date is today or later', () => {
    expect(rollRecurringAnchorForward('2026-01-01', 'semi-monthly', '2026-10-30', schedule)).toBe('2026-11-01');
    // Nov 1 is paid Fri Oct 30, already past on Oct 31, so the next is Nov 16.
    expect(rollRecurringAnchorForward('2026-01-01', 'semi-monthly', '2026-10-31', schedule)).toBe('2026-11-16');
  });

  it('leaves an anchor already in the future alone', () => {
    expect(rollRecurringAnchorForward('2026-12-01', 'semi-monthly', '2026-10-31', schedule)).toBe('2026-12-01');
  });
});
