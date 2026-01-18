import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculatePulseData,
  calculateWeeklyComparison,
  calculateHabitConsistency,
  calculateHeatmapData,
  calculateNetFlowData,
  calculateCategoryTrend
} from './analyticsHelper';
import { Habit, Transaction } from '../../types/schema';

describe('analyticsHelper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed date: 2023-10-15 (Sunday)
    vi.setSystemTime(new Date('2023-10-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculatePulseData', () => {
    it('calculates points and spending correctly', () => {
      const habits = [
        {
          id: '1',
          basePoints: 10,
          type: 'positive',
          completedDates: ['2023-10-15']
        } as Habit
      ];
      const transactions = [
        {
          id: 't1',
          amount: 50,
          date: '2023-10-15',
          category: 'Food'
        } as Transaction
      ];

      const data = calculatePulseData(habits, transactions, 1);

      expect(data).toHaveLength(1);
      expect(data[0].points).toBe(10);
      expect(data[0].spending).toBe(50);
      expect(data[0].fullDate).toBe('2023-10-15');
    });

    it('handles negative habits', () => {
      const habits = [
        {
          id: '1',
          basePoints: 10,
          type: 'negative',
          completedDates: ['2023-10-15']
        } as Habit
      ];
      const transactions: Transaction[] = [];

      const data = calculatePulseData(habits, transactions, 1);

      expect(data[0].points).toBe(-10);
    });
  });

  describe('calculateWeeklyComparison', () => {
    it('compares this week vs last week', () => {
      // 2023-10-15 is Sunday. Week starts Monday 2023-10-09.
      // Last week started Monday 2023-10-02.

      const habits = [
        // This week (Mon Oct 9 - Sun Oct 15)
        { id: '1', basePoints: 10, type: 'positive', completedDates: ['2023-10-09'] } as Habit,
        // Last week (Mon Oct 2 - Sun Oct 8)
        { id: '2', basePoints: 10, type: 'positive', completedDates: ['2023-10-02'] } as Habit,
      ];

      const data = calculateWeeklyComparison(habits);

      expect(data).toHaveLength(7);

      // Monday check
      expect(data[0].day).toBe('Mon');
      expect(data[0]["This Week"]).toBe(10); // Oct 9
      expect(data[0]["Last Week"]).toBe(10); // Oct 2
    });
  });

  describe('calculateHabitConsistency', () => {
    it('aggregates points by category', () => {
      const habits = [
        {
          id: '1',
          category: 'Health',
          basePoints: 10,
          completedDates: ['2023-10-15', '2023-10-14']
        } as Habit
      ];

      const data = calculateHabitConsistency(habits);

      expect(data).toHaveLength(1);
      expect(data[0].subject).toBe('Health');
      expect(data[0].points).toBe(20);
    });
  });

  describe('calculateHeatmapData', () => {
    it('generates 90 days of data with intensity', () => {
      const habits = [
        {
          id: '1',
          completedDates: ['2023-10-15', '2023-10-15', '2023-10-15', '2023-10-15'] // 4 completions
        } as Habit
      ];

      const data = calculateHeatmapData(habits);

      expect(data).toHaveLength(90);

      const todayData = data.find(d => d.date === '2023-10-15');
      expect(todayData).toBeDefined();
      expect(todayData?.count).toBe(4);
      expect(todayData?.intensity).toBe(4); // Max intensity
    });
  });

  describe('calculateNetFlowData', () => {
    it('aggregates income and expense per month', () => {
      const transactions = [
        { id: '1', amount: 1000, category: 'Income', date: '2023-10-01' },
        { id: '2', amount: 500, category: 'Expense', date: '2023-10-05' },
        { id: '3', amount: 200, category: 'Food', date: '2023-10-06' } // Should count as expense if we treat non-income as expense in net flow?
        // Note: The logic in helper filters for t.category === 'Expense' explicitly for expenses.
        // Let's verify the logic:
        // if (t.category === 'Expense') { bucket.expense += t.amount; }
        // This implies 'Food' category won't be counted as Expense in Net Flow chart.
        // Wait, checking previous implementation... yes, it filters: else if (t.category === 'Expense')
      ] as Transaction[];

      const data = calculateNetFlowData(transactions);

      // Oct 2023 should be the last month (since we are in Oct)
      const currentMonth = data[data.length - 1];

      expect(currentMonth.month).toBe('Oct');
      expect(currentMonth.Income).toBe(1000);
      expect(currentMonth.Expense).toBe(500); // Only 'Expense' category
      expect(currentMonth.Net).toBe(500);
    });
  });

  describe('calculateCategoryTrend', () => {
    it('identifies top categories and aggregates data', () => {
      const transactions = [
        { id: '1', amount: 100, category: 'Food', date: '2023-10-01' },
        { id: '2', amount: 50, category: 'Transport', date: '2023-10-02' },
        { id: '3', amount: 20, category: 'Misc', date: '2023-10-03' },
      ] as Transaction[];

      const { data, categories } = calculateCategoryTrend(transactions);

      expect(categories).toContain('Food');
      expect(categories).toContain('Transport');
      expect(categories).toContain('Misc');

      const currentMonth = data[data.length - 1];
      expect(currentMonth['Food']).toBe(100);
      expect(currentMonth['Transport']).toBe(50);
    });
  });
});
