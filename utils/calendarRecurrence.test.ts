import { describe, it, expect } from 'vitest';
import { generateRecurringInstances, expandCalendarItems, generateRecurringId, isRecurringId, parseRecurringId } from './calendarRecurrence';
import { CalendarItem } from '@/types/schema';

describe('calendarRecurrence', () => {
  const baseItem: CalendarItem = {
    id: 'test-item-1',
    title: 'Test Bill',
    amount: 50,
    date: '2024-01-01', // Monday
    type: 'expense',
    isRecurring: false,
    isPaid: false,
    isDeleted: false,
  };

  describe('ID Helper Functions', () => {
    it('generates consistent IDs', () => {
        const id = generateRecurringId('template-1', '2024-01-01');
        expect(id).toBe('template-1_instance_2024-01-01');
    });

    it('identifies recurring IDs correctly', () => {
        expect(isRecurringId('template-1_instance_2024-01-01')).toBe(true);
        expect(isRecurringId('template-1-2024-01-01')).toBe(false); // Old format
        expect(isRecurringId('normal-id')).toBe(false);
    });

    it('parses recurring IDs correctly', () => {
        const parsed = parseRecurringId('template-1_instance_2024-01-01');
        expect(parsed).toEqual({
            templateId: 'template-1',
            date: '2024-01-01'
        });
    });

    it('returns null for invalid IDs', () => {
        expect(parseRecurringId('invalid-id')).toBeNull();
    });

    it('handles IDs containing the separator in the template ID (edge case)', () => {
        // Technically possible if a user somehow creates an ID with '_instance_' in it
        const id = generateRecurringId('weird_instance_id', '2024-01-01');
        expect(id).toBe('weird_instance_id_instance_2024-01-01');

        const parsed = parseRecurringId(id);
        expect(parsed).toEqual({
            templateId: 'weird_instance_id',
            date: '2024-01-01'
        });
    });
  });

  describe('generateRecurringInstances', () => {
    it('returns empty array for non-recurring item outside range', () => {
      const result = generateRecurringInstances(
        baseItem,
        new Date('2024-02-01'),
        new Date('2024-02-28')
      );
      expect(result).toHaveLength(0);
    });

    it('returns original item for non-recurring item inside range', () => {
      const result = generateRecurringInstances(
        baseItem,
        new Date('2023-12-01'),
        new Date('2024-01-31')
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(baseItem.id);
    });

    it('generates weekly instances correctly with new ID format', () => {
      const weeklyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'weekly'
      };

      // Range: Jan 1 to Jan 15 (should cover Jan 1, Jan 8, Jan 15)
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-01-15');

      const result = generateRecurringInstances(weeklyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-01-08');
      expect(result[2].date).toBe('2024-01-15');
      // Check ID generation format
      expect(result[1].id).toBe('test-item-1_instance_2024-01-08');
    });

    it('generates bi-weekly instances correctly', () => {
      const biWeeklyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'bi-weekly'
      };

      // Range: Jan 1 to Jan 29 (Jan 1, Jan 15, Jan 29)
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-01-29');

      const result = generateRecurringInstances(biWeeklyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-01-15');
      expect(result[2].date).toBe('2024-01-29');
    });

    it('generates monthly instances correctly', () => {
      const monthlyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'monthly'
      };

      // Range: Jan 1 to Mar 1
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-03-01');

      const result = generateRecurringInstances(monthlyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-02-01');
      expect(result[2].date).toBe('2024-03-01');
    });

    it('optimizes start date for old recurring items (jump logic)', () => {
      const oldItem: CalendarItem = {
        ...baseItem,
        date: '2020-01-06', // Monday, Jan 6 2020
        isRecurring: true,
        frequency: 'weekly'
      };

      // Range: Jan 1 2024 (Monday) to Jan 8 2024 (Monday)
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-01-08');

      const result = generateRecurringInstances(oldItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(2);
      expect(result[0].date).toBe('2024-01-01');
      expect(result[1].date).toBe('2024-01-08');
    });

    it('handles bi-weekly jumps correctly', () => {
      const oldItem: CalendarItem = {
        ...baseItem,
        date: '2024-01-01',
        isRecurring: true,
        frequency: 'bi-weekly'
      };

      // Range starts 4 weeks later: Jan 29
      const rangeStart = new Date('2024-01-29');
      const rangeEnd = new Date('2024-01-30');

      const result = generateRecurringInstances(oldItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(1);
      expect(result[0].date).toBe('2024-01-29');
    });

    it('handles unknown frequency safely by preventing infinite loop', () => {
        const unknownFreqItem: CalendarItem = {
          ...baseItem,
          isRecurring: true,
          frequency: 'daily' as unknown as 'weekly' | 'bi-weekly' | 'monthly' // Explicitly force unknown frequency for test
        };

        // Range: Jan 1 to Jan 5
        const rangeStart = new Date('2024-01-01');
        const rangeEnd = new Date('2024-01-05');

        const result = generateRecurringInstances(unknownFreqItem, rangeStart, rangeEnd);

        // Should break loop immediately after 1000 iterations or because date doesn't advance
        // In this implementation, date doesn't advance so loop breaks.
        // It will only return the initial instance if it falls in range.
        expect(result.length).toBeLessThanOrEqual(1);
        if (result.length === 1) {
            expect(result[0].date).toBe('2024-01-01');
        }
    });
  });

  describe('expandCalendarItems', () => {
    it('filters out paid instances', () => {
      const recurringItem: CalendarItem = {
        ...baseItem,
        id: 'template-1',
        isRecurring: true,
        frequency: 'weekly'
      };

      const paidInstance: CalendarItem = {
        ...baseItem,
        id: 'paid-1',
        date: '2024-01-08',
        isPaid: true,
        parentRecurringId: 'template-1'
      };

      const items = [recurringItem, paidInstance];
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-01-15');

      const result = expandCalendarItems(items, rangeStart, rangeEnd);

      // Should have Jan 1 (generated), Jan 8 (paid instance), Jan 15 (generated)
      // The generateRecurringInstances would produce Jan 8, but it should be filtered out
      // because a paid instance exists for that date.

      const dates = result.map(i => i.date).sort();
      expect(dates).toEqual(['2024-01-01', '2024-01-08', '2024-01-15']);

      const jan8 = result.find(i => i.date === '2024-01-08');
      expect(jan8?.isPaid).toBe(true);
      expect(jan8?.id).toBe('paid-1');
    });

    it('filters out deleted instances', () => {
      const recurringItem: CalendarItem = {
        ...baseItem,
        id: 'template-1',
        isRecurring: true,
        frequency: 'weekly'
      };

      const deletedInstance: CalendarItem = {
        ...baseItem,
        id: 'deleted-1',
        date: '2024-01-08',
        isDeleted: true,
        parentRecurringId: 'template-1'
      };

      const items = [recurringItem, deletedInstance];
      const rangeStart = new Date('2024-01-01');
      const rangeEnd = new Date('2024-01-15');

      const result = expandCalendarItems(items, rangeStart, rangeEnd);

      // Should have Jan 1 (generated), Jan 15 (generated)
      // Jan 8 should be completely missing because it was deleted

      const dates = result.map(i => i.date).sort();
      expect(dates).toEqual(['2024-01-01', '2024-01-15']);
    });
  });
});
