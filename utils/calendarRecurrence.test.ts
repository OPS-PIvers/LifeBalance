import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
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
        parseISO('2024-02-01'),
        parseISO('2024-02-28')
      );
      expect(result).toHaveLength(0);
    });

    it('returns original item for non-recurring item inside range', () => {
      const result = generateRecurringInstances(
        baseItem,
        parseISO('2023-12-01'),
        parseISO('2024-01-31')
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(baseItem.id);
    });

    it('generates weekly instances correctly with new ID format', () => {
      const weeklyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'weekly'
      };

      // Range: Jan 1 to Jan 15 (should cover Jan 1, Jan 8, Jan 15)
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-15');

      const result = generateRecurringInstances(weeklyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0]!.date).toBe('2024-01-01');
      expect(result[1]!.date).toBe('2024-01-08');
      expect(result[2]!.date).toBe('2024-01-15');
      // Check ID generation format
      expect(result[1]!.id).toBe('test-item-1_instance_2024-01-08');
    });

    it('generates bi-weekly instances correctly', () => {
      const biWeeklyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'bi-weekly'
      };

      // Range: Jan 1 to Jan 29 (Jan 1, Jan 15, Jan 29)
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-29');

      const result = generateRecurringInstances(biWeeklyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0]!.date).toBe('2024-01-01');
      expect(result[1]!.date).toBe('2024-01-15');
      expect(result[2]!.date).toBe('2024-01-29');
    });

    it('generates monthly instances correctly', () => {
      const monthlyItem: CalendarItem = {
        ...baseItem,
        isRecurring: true,
        frequency: 'monthly'
      };

      // Range: Jan 1 to Mar 1
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-03-01');

      const result = generateRecurringInstances(monthlyItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(3);
      expect(result[0]!.date).toBe('2024-01-01');
      expect(result[1]!.date).toBe('2024-02-01');
      expect(result[2]!.date).toBe('2024-03-01');
    });

    it('keeps month-end monthly items anchored to the original day across short months', () => {
      const monthEndItem: CalendarItem = {
        ...baseItem,
        date: '2026-01-31',
        isRecurring: true,
        frequency: 'monthly'
      };

      const result = generateRecurringInstances(
        monthEndItem,
        parseISO('2026-01-01'),
        parseISO('2026-05-31')
      );

      // Each occurrence clamps independently from the Jan 31 anchor:
      // February clamps to the 28th, but March/May recover the 31st.
      expect(result.map(i => i.date)).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);
    });

    it('produces identical monthly occurrence dates regardless of window start', () => {
      const monthEndItem: CalendarItem = {
        ...baseItem,
        date: '2026-01-31',
        isRecurring: true,
        frequency: 'monthly'
      };

      // Expansion iterating from the anchor (window includes the anchor)...
      const fromAnchor = generateRecurringInstances(
        monthEndItem,
        parseISO('2026-01-01'),
        parseISO('2026-03-31')
      );
      // ...vs expansion that jumps into March (window starts mid-range).
      const fromMarch = generateRecurringInstances(
        monthEndItem,
        parseISO('2026-03-01'),
        parseISO('2026-03-31')
      );

      const marchFromAnchor = fromAnchor.find(i => i.date.startsWith('2026-03'));
      expect(fromMarch.map(i => i.date)).toEqual([marchFromAnchor!.date]);
      // Same occurrence must get the same synthetic ID across windows,
      // otherwise paid-instance suppression breaks.
      expect(fromMarch[0]!.id).toBe(marchFromAnchor!.id);
    });

    it('optimizes start date for old recurring items (jump logic)', () => {
      const oldItem: CalendarItem = {
        ...baseItem,
        date: '2020-01-06', // Monday, Jan 6 2020
        isRecurring: true,
        frequency: 'weekly'
      };

      // Range: Jan 1 2024 (Monday) to Jan 8 2024 (Monday)
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-08');

      const result = generateRecurringInstances(oldItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(2);
      expect(result[0]!.date).toBe('2024-01-01');
      expect(result[1]!.date).toBe('2024-01-08');
    });

    it('handles bi-weekly jumps correctly', () => {
      const oldItem: CalendarItem = {
        ...baseItem,
        date: '2024-01-01',
        isRecurring: true,
        frequency: 'bi-weekly'
      };

      // Range starts 4 weeks later: Jan 29
      const rangeStart = parseISO('2024-01-29');
      const rangeEnd = parseISO('2024-01-30');

      const result = generateRecurringInstances(oldItem, rangeStart, rangeEnd);

      expect(result).toHaveLength(1);
      expect(result[0]!.date).toBe('2024-01-29');
    });

    it('handles unknown frequency safely by preventing infinite loop', () => {
        const unknownFreqItem: CalendarItem = {
          ...baseItem,
          isRecurring: true,
          frequency: 'daily' as unknown as 'weekly' | 'bi-weekly' | 'monthly' // Explicitly force unknown frequency for test
        };

        // Range: Jan 1 to Jan 5
        const rangeStart = parseISO('2024-01-01');
        const rangeEnd = parseISO('2024-01-05');

        const result = generateRecurringInstances(unknownFreqItem, rangeStart, rangeEnd);

        // Should break loop immediately after 1000 iterations or because date doesn't advance
        // In this implementation, date doesn't advance so loop breaks.
        // It will only return the initial instance if it falls in range.
        expect(result.length).toBeLessThanOrEqual(1);
        if (result.length === 1) {
            expect(result[0]!.date).toBe('2024-01-01');
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
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-15');

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

    it('excludes out-of-range non-recurring items and paid instances', () => {
      // Non-recurring item inside the range
      const inRangeItem: CalendarItem = {
        ...baseItem,
        id: 'in-range',
        date: '2024-01-08',
        isRecurring: false,
      };

      // Non-recurring item before the range start
      const beforeRangeItem: CalendarItem = {
        ...baseItem,
        id: 'before-range',
        date: '2023-12-31',
        isRecurring: false,
      };

      // Non-recurring item after the range end
      const afterRangeItem: CalendarItem = {
        ...baseItem,
        id: 'after-range',
        date: '2024-01-16',
        isRecurring: false,
      };

      // A recurring template
      const recurringTemplate: CalendarItem = {
        ...baseItem,
        id: 'template-2',
        date: '2024-01-01',
        isRecurring: true,
        frequency: 'weekly',
      };

      // Paid instance inside the range (replaces the Jan 1 generated instance)
      const paidInRange: CalendarItem = {
        ...baseItem,
        id: 'paid-in-range',
        date: '2024-01-01',
        isPaid: true,
        parentRecurringId: 'template-2',
      };

      // Paid instance outside the range — should be excluded
      const paidOutOfRange: CalendarItem = {
        ...baseItem,
        id: 'paid-out-of-range',
        date: '2023-12-25',
        isPaid: true,
        parentRecurringId: 'template-2',
      };

      const items = [
        inRangeItem,
        beforeRangeItem,
        afterRangeItem,
        recurringTemplate,
        paidInRange,
        paidOutOfRange,
      ];

      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-15');

      const result = expandCalendarItems(items, rangeStart, rangeEnd);

      const ids = result.map(i => i.id).sort();

      // inRangeItem (non-recurring, inside range) must be present
      expect(ids).toContain('in-range');

      // paidInRange (paid instance replacing Jan 1 generated) must be present
      expect(ids).toContain('paid-in-range');

      // Items outside the range must be absent
      expect(ids).not.toContain('before-range');
      expect(ids).not.toContain('after-range');
      expect(ids).not.toContain('paid-out-of-range');
    });

    it('suppresses a paid month-end occurrence even when the window starts mid-range', () => {
      const monthEndTemplate: CalendarItem = {
        ...baseItem,
        id: 'rent-template',
        date: '2026-01-31',
        isRecurring: true,
        frequency: 'monthly'
      };

      // The March occurrence was paid; its date must match the expansion of any window.
      const paidMarch: CalendarItem = {
        ...baseItem,
        id: 'rent-paid-march',
        date: '2026-03-31',
        isPaid: true,
        parentRecurringId: 'rent-template'
      };

      // Window starting after the anchor (jump path), like a safe-to-spend
      // window anchored on a mid-March paycheck.
      const result = expandCalendarItems(
        [monthEndTemplate, paidMarch],
        parseISO('2026-03-15'),
        parseISO('2026-04-30')
      );

      const marchInstances = result.filter(i => i.date.startsWith('2026-03'));
      // Exactly one March instance: the paid one — no unpaid duplicate.
      expect(marchInstances).toHaveLength(1);
      expect(marchInstances[0]!.id).toBe('rent-paid-march');
      expect(marchInstances[0]!.isPaid).toBe(true);
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
      const rangeStart = parseISO('2024-01-01');
      const rangeEnd = parseISO('2024-01-15');

      const result = expandCalendarItems(items, rangeStart, rangeEnd);

      // Should have Jan 1 (generated), Jan 15 (generated)
      // Jan 8 should be completely missing because it was deleted

      const dates = result.map(i => i.date).sort();
      expect(dates).toEqual(['2024-01-01', '2024-01-15']);
    });
  });
});
