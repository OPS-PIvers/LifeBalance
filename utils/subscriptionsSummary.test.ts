import { describe, expect, it } from 'vitest';
import { summarizeRecurringItems } from '@/utils/subscriptionsSummary';
import { CalendarItem } from '@/types/schema';

function makeItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'id-1',
    title: 'Item',
    amount: 10,
    date: '2026-01-01',
    type: 'expense',
    isPaid: false,
    ...overrides,
  };
}

describe('summarizeRecurringItems', () => {
  it('normalizes monthly items as-is', () => {
    const items = [
      makeItem({ id: 'm1', title: 'Netflix', amount: 15.49, isRecurring: true, frequency: 'monthly' }),
    ];
    const result = summarizeRecurringItems(items);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.monthlyEquivalent).toBe(15.49);
    expect(result.totalMonthly).toBe(15.49);
  });

  it('normalizes weekly items to monthly-equivalent (amount * 52/12)', () => {
    const items = [
      makeItem({ id: 'w1', title: 'Cleaning', amount: 20, isRecurring: true, frequency: 'weekly' }),
    ];
    const result = summarizeRecurringItems(items);
    expect(result.items[0]?.monthlyEquivalent).toBeCloseTo(86.67, 2);
  });

  it('normalizes bi-weekly items to monthly-equivalent (amount * 26/12)', () => {
    const items = [
      makeItem({ id: 'b1', title: 'Lawn care', amount: 40, isRecurring: true, frequency: 'bi-weekly' }),
    ];
    const result = summarizeRecurringItems(items);
    expect(result.items[0]?.monthlyEquivalent).toBeCloseTo(86.67, 2);
  });

  it('excludes non-recurring items', () => {
    const items = [makeItem({ id: 'n1', isRecurring: false })];
    expect(summarizeRecurringItems(items).items).toHaveLength(0);
  });

  it('excludes recurring items missing a frequency', () => {
    const items = [makeItem({ id: 'nf1', isRecurring: true, frequency: undefined })];
    expect(summarizeRecurringItems(items).items).toHaveLength(0);
  });

  it('excludes recurring income items', () => {
    const items = [
      makeItem({ id: 'inc1', type: 'income', isRecurring: true, frequency: 'monthly' }),
    ];
    expect(summarizeRecurringItems(items).items).toHaveLength(0);
  });

  it('excludes paid/deleted instances (items with parentRecurringId)', () => {
    const items = [
      makeItem({
        id: 'inst1',
        isRecurring: true,
        frequency: 'monthly',
        parentRecurringId: 'template1',
        isPaid: true,
      }),
    ];
    expect(summarizeRecurringItems(items).items).toHaveLength(0);
  });

  it('sorts items by monthly-equivalent cost descending', () => {
    const items = [
      makeItem({ id: 'small', title: 'Small', amount: 5, isRecurring: true, frequency: 'monthly' }),
      makeItem({ id: 'big', title: 'Big', amount: 50, isRecurring: true, frequency: 'monthly' }),
      makeItem({ id: 'mid', title: 'Mid', amount: 20, isRecurring: true, frequency: 'monthly' }),
    ];
    const result = summarizeRecurringItems(items);
    expect(result.items.map(i => i.item.id)).toEqual(['big', 'mid', 'small']);
  });

  it('sums totalMonthly across mixed cadences without float drift', () => {
    const items = [
      makeItem({ id: 'a', amount: 9.99, isRecurring: true, frequency: 'monthly' }),
      makeItem({ id: 'b', amount: 4.99, isRecurring: true, frequency: 'weekly' }),
      makeItem({ id: 'c', amount: 12.5, isRecurring: true, frequency: 'bi-weekly' }),
    ];
    const result = summarizeRecurringItems(items);
    const expectedTotal =
      9.99 + Math.round(4.99 * (52 / 12) * 100) / 100 + Math.round(12.5 * (26 / 12) * 100) / 100;
    expect(result.totalMonthly).toBeCloseTo(expectedTotal, 2);
  });

  it('returns an empty summary for no items', () => {
    const result = summarizeRecurringItems([]);
    expect(result.items).toEqual([]);
    expect(result.totalMonthly).toBe(0);
    expect(result.subscriptions).toEqual([]);
    expect(result.subscriptionsMonthly).toBe(0);
    expect(result.otherBills).toEqual([]);
    expect(result.otherBillsMonthly).toBe(0);
  });

  it('partitions by the explicit isSubscription flag (recurring alone is NOT a subscription)', () => {
    const items = [
      makeItem({ id: 'sub1', title: 'Netflix', amount: 15.49, isRecurring: true, frequency: 'monthly', isSubscription: true }),
      makeItem({ id: 'bill1', title: 'Mortgage', amount: 2066, isRecurring: true, frequency: 'monthly' }),
      makeItem({ id: 'bill2', title: 'Car Payment', amount: 498, isRecurring: true, frequency: 'monthly', isSubscription: false }),
    ];
    const result = summarizeRecurringItems(items);
    expect(result.subscriptions.map(i => i.item.id)).toEqual(['sub1']);
    expect(result.otherBills.map(i => i.item.id)).toEqual(['bill1', 'bill2']);
    expect(result.subscriptionsMonthly).toBe(15.49);
    expect(result.otherBillsMonthly).toBe(2564);
    expect(result.totalMonthly).toBeCloseTo(2579.49, 2);
  });
});
