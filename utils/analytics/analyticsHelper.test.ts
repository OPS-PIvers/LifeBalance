import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculatePulseData,
  calculateWeeklyComparison,
  calculateHabitConsistency,
  calculateHeatmapData,
  calculateCategoryTrend
} from './analyticsHelper';
import { Habit, Transaction } from '@/types/schema';

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
      expect(data[0]!.points).toBe(10);
      expect(data[0]!.spending).toBe(50);
      expect(data[0]!.fullDate).toBe('2023-10-15');
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

      expect(data[0]!.points).toBe(-10);
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
      expect(data[0]!.day).toBe('Mon');
      expect(data[0]!["This Week"]).toBe(10); // Oct 9
      expect(data[0]!["Last Week"]).toBe(10); // Oct 2
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
      expect(data[0]!.subject).toBe('Health');
      expect(data[0]!.points).toBe(20);
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

    it('normalizes intensity against the 90-day window max, not all-time max', () => {
      // Window is 2023-07-18..2023-10-15. A peak day of 8 completions on
      // 2023-06-01 (outside the window) must not set the intensity ceiling.
      const oldPeak = Array.from({ length: 8 }, (_, i) => ({
        id: `old-${i}`,
        completedDates: ['2023-06-01']
      } as Habit));
      const inWindow = Array.from({ length: 5 }, (_, i) => ({
        id: `new-${i}`,
        completedDates: ['2023-10-15']
      } as Habit));

      const data = calculateHeatmapData([...oldPeak, ...inWindow]);

      expect(data).toHaveLength(90);
      // Off-window peak day is not rendered at all
      expect(data.find(d => d.date === '2023-06-01')).toBeUndefined();

      // Best in-window day (5 completions) gets max intensity; with the
      // all-time max of 8 it would wrongly be 3 (5 < 8 * 0.75).
      const todayData = data.find(d => d.date === '2023-10-15');
      expect(todayData?.count).toBe(5);
      expect(todayData?.intensity).toBe(4);
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

      const currentMonth = data[data.length - 1]!;
      expect(currentMonth['Food']).toBe(100);
      expect(currentMonth['Transport']).toBe(50);
    });
  });
});
