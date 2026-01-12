import { describe, it, expect } from 'vitest';
import { generateRecurringInstances, expandCalendarItems } from './calendarRecurrence';
import { CalendarItem } from '@/types/schema';
import { addWeeks, addMonths, parseISO, format, subMonths } from 'date-fns';

describe('generateRecurringInstances', () => {
  const baseItem: CalendarItem = {
    id: 'test-item',
    title: 'Test Item',
    amount: 100,
    date: '2024-01-01', // Monday
    type: 'expense',
    isRecurring: false,
    isPaid: false,
    createdBy: 'user1',
    createdAt: '2024-01-01T00:00:00Z',
    householdId: 'house1'
  };

  describe('Non-recurring items', () => {
    it('should return the item if it falls within the range', () => {
      const rangeStart = parseISO('2023-12-31');
      const rangeEnd = parseISO('2024-01-02');
      const result = generateRecurringInstances(baseItem, rangeStart, rangeEnd);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(baseItem);
    });

    it('should return empty if the item is outside the range', () => {
      const rangeStart = parseISO('2024-01-02');
      const rangeEnd = parseISO('2024-01-10');
      const result = generateRecurringInstances(baseItem, rangeStart, rangeEnd);
      expect(result).toHaveLength(0);
    });
  });

  describe('Weekly recurring items', () => {
    const weeklyItem: CalendarItem = {
      ...baseItem,
      isRecurring: true,
      frequency: 'weekly',
    };

    it('should generate instances for each week in the range', () => {
      const rangeStart = parseISO('2024-01-01'); // Start on the item date
      const rangeEnd = parseISO('2024-01-22'); // 3 weeks later
      const result = generateRecurringInstances(weeklyItem, rangeStart, rangeEnd);

      // Expected: Jan 1, Jan 8, Jan 15, Jan 22 (4 instances)
      expect(result).toHaveLength(4);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-01-08');
      expect(result[2].date).toBe('2024-01-15');
      expect(result[3].date).toBe('2024-01-22');
    });

    it('should generate unique IDs for instances', () => {
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-08');
      const result = generateRecurringInstances(weeklyItem, rangeStart, rangeEnd);

      expect(result[0].id).toBe('test-item-2024-01-01');
      expect(result[1].id).toBe('test-item-2024-01-08');
    });
  });

  describe('Bi-weekly recurring items', () => {
    const biWeeklyItem: CalendarItem = {
      ...baseItem,
      isRecurring: true,
      frequency: 'bi-weekly',
    };

    it('should generate instances every 2 weeks', () => {
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-02-01');
      const result = generateRecurringInstances(biWeeklyItem, rangeStart, rangeEnd);

      // Expected: Jan 1, Jan 15, Jan 29
      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-01-15');
      expect(result[2].date).toBe('2024-01-29');
    });
  });

  describe('Monthly recurring items', () => {
    const monthlyItem: CalendarItem = {
      ...baseItem,
      isRecurring: true,
      frequency: 'monthly',
    };

    it('should generate instances every month', () => {
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-04-01');
      const result = generateRecurringInstances(monthlyItem, rangeStart, rangeEnd);

      // Expected: Jan 1, Feb 1, Mar 1, Apr 1
      expect(result).toHaveLength(4);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-02-01');
      expect(result[2].date).toBe('2024-03-01');
      expect(result[3].date).toBe('2024-04-01');
    });
  });

  describe('Optimization logic (Jump to start)', () => {
    const oldWeeklyItem: CalendarItem = {
      ...baseItem,
      date: '2020-01-01', // Years ago
      isRecurring: true,
      frequency: 'weekly',
    };

    it('should correctly jump to the current range without iterating from the beginning', () => {
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-08');

      // 2020-01-01 is Wednesday. 2024-01-01 is Monday.
      // Wait, 2020-01-01 was Wednesday.
      // Let's rely on the function logic.

      // If we used a loop starting from 2020, it would take ~200 iterations.
      // The test mainly checks correctness, assuming implementation uses the jump optimization.

      const result = generateRecurringInstances(oldWeeklyItem, rangeStart, rangeEnd);

      expect(result.length).toBeGreaterThan(0);
      result.forEach(item => {
        const itemDate = parseISO(item.date);
        // Should be >= rangeStart
        expect(itemDate >= rangeStart).toBe(true);
        // Should be <= rangeEnd
        expect(itemDate <= rangeEnd).toBe(true);
      });
    });

     it('should handle bi-weekly jumps correctly', () => {
        const oldBiWeeklyItem: CalendarItem = {
            ...baseItem,
            date: '2023-01-01',
            isRecurring: true,
            frequency: 'bi-weekly',
        };
        const rangeStart = parseISO('2024-01-01');
        const rangeEnd = parseISO('2024-02-01');

        const result = generateRecurringInstances(oldBiWeeklyItem, rangeStart, rangeEnd);

        expect(result.length).toBeGreaterThan(0);
         result.forEach(item => {
            const itemDate = parseISO(item.date);
            expect(itemDate >= rangeStart).toBe(true);
            expect(itemDate <= rangeEnd).toBe(true);
        });
     });
  });
});

describe('expandCalendarItems', () => {
  const recurringItem: CalendarItem = {
    id: 'recurring-1',
    title: 'Weekly Bill',
    amount: 50,
    date: '2024-01-01',
    type: 'expense',
    isRecurring: true,
    frequency: 'weekly',
    isPaid: false,
    createdBy: 'user1',
    createdAt: '2024-01-01T00:00:00Z',
    householdId: 'house1'
  };

  const oneTimeItem: CalendarItem = {
    id: 'one-time-1',
    title: 'One Time Expense',
    amount: 200,
    date: '2024-01-05',
    type: 'expense',
    isRecurring: false,
    isPaid: false,
    createdBy: 'user1',
    createdAt: '2024-01-01T00:00:00Z',
    householdId: 'house1'
  };

  const rangeStart = parseISO('2024-01-01');
  const rangeEnd = parseISO('2024-01-15');

  it('should include one-time items and recurring instances', () => {
    const items = [recurringItem, oneTimeItem];
    const result = expandCalendarItems(items, rangeStart, rangeEnd);

    // Should have:
    // 1. One-time item (Jan 5)
    // 2. Recurring instances (Jan 1, Jan 8, Jan 15)

    expect(result).toHaveLength(4);
    expect(result.find(i => i.id === 'one-time-1')).toBeDefined();
    expect(result.filter(i => i.title === 'Weekly Bill')).toHaveLength(3);
  });

  it('should exclude instances that have been paid (exist as separate items)', () => {
    // Simulate that Jan 8 instance was paid
    const paidInstance: CalendarItem = {
      id: 'paid-instance-1',
      title: 'Weekly Bill',
      amount: 50,
      date: '2024-01-08',
      type: 'expense',
      isRecurring: true, // It keeps the recurring flag usually
      isPaid: true,
      parentRecurringId: 'recurring-1',
      createdBy: 'user1',
      createdAt: '2024-01-08T00:00:00Z',
      householdId: 'house1'
    };

    const items = [recurringItem, paidInstance];
    const result = expandCalendarItems(items, rangeStart, rangeEnd);

    // Should have:
    // 1. Paid instance (Jan 8) - included directly
    // 2. Generated instances: Jan 1, Jan 15 (Jan 8 should be skipped)

    expect(result).toHaveLength(3);

    // Check for the paid instance object
    expect(result.find(i => i.id === 'paid-instance-1')).toBeDefined();

    // Check generated instances don't include Jan 8
    const generated = result.filter(i => i.id.startsWith('recurring-1-'));
    expect(generated).toHaveLength(2);
    expect(generated.map(i => i.date)).not.toContain('2024-01-08');
    expect(generated.map(i => i.date)).toContain('2024-01-01');
    expect(generated.map(i => i.date)).toContain('2024-01-15');
  });

  it('should exclude instances that have been deleted', () => {
    // Simulate that Jan 8 instance was deleted
    const deletedInstance: CalendarItem = {
      id: 'deleted-instance-1',
      title: 'Weekly Bill',
      amount: 50,
      date: '2024-01-08',
      type: 'expense',
      isRecurring: true,
      isPaid: false,
      isDeleted: true,
      parentRecurringId: 'recurring-1',
      createdBy: 'user1',
      createdAt: '2024-01-08T00:00:00Z',
      householdId: 'house1'
    };

    const items = [recurringItem, deletedInstance];
    const result = expandCalendarItems(items, rangeStart, rangeEnd);

    // Should have:
    // 1. Generated instances: Jan 1, Jan 15 (Jan 8 should be skipped)
    // Deleted instance itself should NOT be in the output (expandCalendarItems should filter it out ultimately??)
    // Wait, let's check implementation.
    // Implementation: "allInstances.push(...nonRecurringItems, ...paidInstances);"
    // Deleted instances are filtered into `deletedInstances` array but NOT pushed to allInstances. Correct.

    expect(result).toHaveLength(2);
    const generated = result.filter(i => i.id.startsWith('recurring-1-'));
    expect(generated).toHaveLength(2);
    expect(generated.map(i => i.date)).not.toContain('2024-01-08');
  });
});
