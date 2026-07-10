import { describe, it, expect } from 'vitest';
import {
  BUDGETED_IN_CALENDAR,
  LEGACY_BILLS_CATEGORY,
  buildTransactionCategoryOptions,
  isCalendarBudgetedCategory,
} from './categories';

const bucket = (name: string) => ({ name });

describe('buildTransactionCategoryOptions', () => {
  it('appends the Budgeted in Calendar sentinel after bucket names', () => {
    expect(buildTransactionCategoryOptions([bucket('Groceries'), bucket('Gas')])).toEqual([
      'Groceries',
      'Gas',
      BUDGETED_IN_CALENDAR,
    ]);
  });

  it('returns only the sentinel when there are no buckets', () => {
    expect(buildTransactionCategoryOptions([])).toEqual([BUDGETED_IN_CALENDAR]);
  });

  it('sorts bucket names when requested, keeping the sentinel last', () => {
    expect(
      buildTransactionCategoryOptions([bucket('Utilities'), bucket('Aardvark Fund')], { sort: true })
    ).toEqual(['Aardvark Fund', 'Utilities', BUDGETED_IN_CALENDAR]);
  });

  it('dedupes repeated bucket names so list keys stay unique', () => {
    expect(
      buildTransactionCategoryOptions([bucket('Groceries'), bucket('Groceries'), bucket('Gas')])
    ).toEqual(['Groceries', 'Gas', BUDGETED_IN_CALENDAR]);
  });

  it('dedupes before sorting', () => {
    expect(
      buildTransactionCategoryOptions([bucket('Gas'), bucket('Groceries'), bucket('Gas')], { sort: true })
    ).toEqual(['Gas', 'Groceries', BUDGETED_IN_CALENDAR]);
  });

  it('does not mutate the input array', () => {
    const buckets = [bucket('B'), bucket('A')];
    buildTransactionCategoryOptions(buckets, { sort: true });
    expect(buckets.map(b => b.name)).toEqual(['B', 'A']);
  });
});

describe('isCalendarBudgetedCategory', () => {
  it('recognizes the Budgeted in Calendar sentinel', () => {
    expect(isCalendarBudgetedCategory(BUDGETED_IN_CALENDAR)).toBe(true);
  });

  it('recognizes the legacy Bills category', () => {
    expect(isCalendarBudgetedCategory(LEGACY_BILLS_CATEGORY)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCalendarBudgetedCategory('budgeted in calendar')).toBe(true);
    expect(isCalendarBudgetedCategory('BILLS')).toBe(true);
  });

  it('returns false for regular bucket categories', () => {
    expect(isCalendarBudgetedCategory('Groceries')).toBe(false);
    expect(isCalendarBudgetedCategory('Gas')).toBe(false);
  });

  it('returns false for null/undefined/empty', () => {
    expect(isCalendarBudgetedCategory(null)).toBe(false);
    expect(isCalendarBudgetedCategory(undefined)).toBe(false);
    expect(isCalendarBudgetedCategory('')).toBe(false);
  });
});
