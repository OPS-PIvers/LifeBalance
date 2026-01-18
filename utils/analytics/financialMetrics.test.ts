import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { calculateBurnDown } from './financialMetrics';
import { Transaction } from '../../types/schema';

describe('calculateBurnDown', () => {
  const periodStart = '2023-10-01';
  const periodEnd = '2023-10-30'; // 30 days inclusive (01 to 30) = 30 days
  const totalBudget = 3000; // 100 per day

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates burn down correctly for past dates', () => {
    // Set "now" to be after the period
    vi.setSystemTime(new Date('2023-11-01'));

    const transactions = [
      { id: '1', amount: 100, date: '2023-10-01', category: 'Food', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
      { id: '2', amount: 200, date: '2023-10-02', category: 'Rent', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
    ] as Transaction[];

    const data = calculateBurnDown(transactions, periodStart, periodEnd, totalBudget);

    // differenceInDays(2023-10-30, 2023-10-01) = 29. +1 = 30 days.
    expect(data).toHaveLength(30);

    expect(data[0].day).toBe('Day 1');
    expect(data[0].spent).toBe(100);
    expect(data[0].idealPacing).toBe(100);

    expect(data[1].day).toBe('Day 2');
    expect(data[1].spent).toBe(300); // 100 + 200
    expect(data[1].idealPacing).toBe(200);
  });

  it('stops plotting actual spent for future dates', () => {
    // Set "now" to be middle of period
    vi.setSystemTime(new Date('2023-10-15T12:00:00'));

    const transactions = [] as Transaction[];

    const data = calculateBurnDown(transactions, periodStart, periodEnd, totalBudget);

    // It returns data for all days, but 'spent' should be null for future days
    // 2023-10-01 is Day 1.
    // 2023-10-15 is Day 15.
    // 2023-10-16 is Day 16 (Future).

    // Day 15 (Index 14)
    expect(data[14].date).toBe('2023-10-15');
    expect(data[14].spent).not.toBeNull();

    // Day 16 (Index 15)
    expect(data[15].date).toBe('2023-10-16');
    expect(data[15].spent).toBeNull();
  });
});
