import { describe, expect, it } from 'vitest';
import type { ToDo, WallEvent } from '@/types/schema';
import { dueTodayTodos, eventsOn, tomorrowPreview } from './wallSelectors';

const todo = (id: string, date: string, done = false): ToDo =>
  ({ id, text: id, completeByDate: date, isCompleted: done }) as ToDo;
const ev = (id: string, date: string, start?: string, extra: Partial<WallEvent> = {}): WallEvent => ({
  id, source: 'feed', ownerKey: 'family', title: id, date, allDay: !start, ...(start ? { start } : {}), ...extra,
});

describe('dueTodayTodos', () => {
  it('keeps open overdue and due-today items, oldest first', () => {
    const list = [todo('late', '2026-10-01'), todo('today', '2026-10-03'), todo('later', '2026-10-05'), todo('done', '2026-10-02', true)];
    expect(dueTodayTodos(list, '2026-10-03').map(t => t.id)).toEqual(['late', 'today']);
  });
});

describe('eventsOn / tomorrowPreview', () => {
  const events = [
    ev('soccer', '2026-10-04', '2026-10-04T15:00:00-05:00'),
    ev('market', '2026-10-04', '2026-10-04T10:00:00-05:00'),
    ev('water', '2026-10-04', undefined, { source: 'bill' }),
    ev('other', '2026-10-05', '2026-10-05T09:00:00-05:00'),
  ];

  it('orders all-day first, then by start', () => {
    expect(eventsOn(events, '2026-10-04').map(e => e.id)).toEqual(['water', 'market', 'soccer']);
  });

  it('previews the first two timed events and the all-day ones, leaving bills out', () => {
    const more = [...events, ev('late', '2026-10-04', '2026-10-04T19:00:00-05:00'), ev('visit', '2026-10-04', undefined, { source: 'holiday' })];
    const p = tomorrowPreview(more, '2026-10-04');
    expect(p.timed.map(e => e.id)).toEqual(['market', 'soccer']);
    expect(p.allDay.map(e => e.id)).toEqual(['visit']);
    expect(tomorrowPreview(events, '2026-10-09')).toEqual({ timed: [], allDay: [] });
  });
});
