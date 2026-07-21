import { describe, it, expect } from 'vitest';
import { getBillLinkCandidates } from './billLinkCandidates';
import { CalendarItem } from '@/types/schema';

const item = (over: Partial<CalendarItem> = {}): CalendarItem => ({
  id: 'item-1',
  title: 'Comcast',
  amount: 100,
  date: '2026-07-15',
  type: 'expense',
  isPaid: false,
  ...over,
});

describe('getBillLinkCandidates', () => {
  it('excludes paid items', () => {
    const items = [item({ id: 'a', isPaid: true }), item({ id: 'b', isPaid: false })];
    expect(getBillLinkCandidates(items).map(i => i.id)).toEqual(['b']);
  });

  it('excludes income items', () => {
    const items = [item({ id: 'a', type: 'income' }), item({ id: 'b', type: 'expense' })];
    expect(getBillLinkCandidates(items).map(i => i.id)).toEqual(['b']);
  });

  it('sorts chronologically ascending', () => {
    const items = [
      item({ id: 'later', date: '2026-08-01' }),
      item({ id: 'earlier', date: '2026-07-01' }),
      item({ id: 'middle', date: '2026-07-15' }),
    ];
    expect(getBillLinkCandidates(items).map(i => i.id)).toEqual(['earlier', 'middle', 'later']);
  });

  it('preserves synthetic recurring occurrence ids', () => {
    const items = [item({ id: 'tmpl-1_instance_2026-07-15' })];
    expect(getBillLinkCandidates(items).map(i => i.id)).toEqual(['tmpl-1_instance_2026-07-15']);
  });
});
