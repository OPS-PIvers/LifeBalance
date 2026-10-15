import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '@/types/schema';
import { halfDates, ordinal, phoneBlocks, quietLabel } from '@/utils/sheetLayout';

const bill = (date: string, title = 'Bill'): CalendarItem => ({
  id: `${title}-${date}`,
  title,
  amount: 10,
  date,
  type: 'expense',
  isPaid: false,
});

describe('halfDates', () => {
  it('gives every day of the half, including the last day of a short month', () => {
    expect(halfDates({ start: '2026-10-01', end: '2026-10-15' })).toHaveLength(15);
    expect(halfDates({ start: '2026-02-16', end: '2026-02-28' }).at(-1)).toBe('2026-02-28');
  });
});

describe('phoneBlocks', () => {
  const half = { start: '2026-10-01', end: '2026-10-15' };

  it('keeps due days and collapses each quiet run into one line', () => {
    const blocks = phoneBlocks(half, [bill('2026-10-01', 'Mortgage'), bill('2026-10-01', 'Xcel'), bill('2026-10-07'), bill('2026-10-13')]);
    expect(blocks).toEqual([
      { kind: 'day', date: '2026-10-01', bills: [expect.objectContaining({ title: 'Mortgage' }), expect.objectContaining({ title: 'Xcel' })] },
      { kind: 'quiet', from: '2026-10-02', to: '2026-10-06' },
      { kind: 'day', date: '2026-10-07', bills: [expect.anything()] },
      { kind: 'quiet', from: '2026-10-08', to: '2026-10-12' },
      { kind: 'day', date: '2026-10-13', bills: [expect.anything()] },
      { kind: 'quiet', from: '2026-10-14', to: '2026-10-15' },
    ]);
  });

  it('is one quiet line when nothing is due', () => {
    expect(phoneBlocks(half, [])).toEqual([{ kind: 'quiet', from: '2026-10-01', to: '2026-10-15' }]);
  });
});

describe('labels', () => {
  it('reads a quiet run like "Oct 8–12", or one day like "Oct 4"', () => {
    expect(quietLabel('2026-10-08', '2026-10-12')).toBe('Oct 8–12');
    expect(quietLabel('2026-10-04', '2026-10-04')).toBe('Oct 4');
  });

  it('writes ordinals for "+ Add to the 1st"', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st',
    ]);
  });
});
