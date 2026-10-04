import { describe, expect, it } from 'vitest';
import type { ToDo, WallEvent } from '@/types/schema';
import {
  addDaysTo,
  dueTodayChecklist,
  eventTimeText,
  groupComingUp,
  layoutDayBlocks,
  longDateText,
  monthCells,
  outsideDayHours,
  todayTimeline,
} from './wallCalendar';

const TZ = 'America/Chicago';
const ev = (id: string, date: string, start?: string, end?: string, extra: Partial<WallEvent> = {}): WallEvent => ({
  id,
  source: 'feed',
  ownerKey: 'family',
  title: id,
  date,
  allDay: !start,
  ...(start ? { start } : {}),
  ...(end ? { end } : {}),
  ...extra,
});
// Chicago is UTC-5 in October.
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00-05:00`;

describe('date helpers', () => {
  it('steps across month, year and DST boundaries', () => {
    expect(addDaysTo('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysTo('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysTo('2026-11-01', 1)).toBe('2026-11-02'); // US DST ends Nov 1
    expect(addDaysTo('2026-03-01', -1)).toBe('2026-02-28');
    expect(longDateText('2026-10-07')).toBe('Wednesday, October 7');
  });

  it('formats event times in the household zone with the am/pm rule', () => {
    expect(eventTimeText('2026-10-03T20:30:00Z', TZ)).toBe('3:30');
    expect(eventTimeText('2026-10-03T11:00:00Z', TZ)).toBe('6:00 am');
    expect(eventTimeText('2026-10-04T02:15:00Z', TZ)).toBe('9:15 pm');
  });
});

describe('todayTimeline', () => {
  const D = '2026-10-03';
  const events = [
    ev('party', D, at(D, '11:30'), at(D, '13:30')),
    ev('soccer', D, at(D, '09:00'), at(D, '10:30')),
    ev('haircut', D, at(D, '14:00'), at(D, '15:00')),
    ev('dinner', D, at(D, '17:00'), at(D, '20:00')),
    ev('water', D, undefined, undefined, { source: 'bill' }),
    ev('no school', D),
    ev('tomorrow', '2026-10-04', at('2026-10-04', '09:00')),
  ];

  it('fades past events and puts the now line before the next one', () => {
    const t = todayTimeline(events, D, new Date(at(D, '15:15')), TZ);
    expect(t.rows.map(r => [r.event.id, r.time, r.past])).toEqual([
      ['soccer', '9:00', true],
      ['party', '11:30', true],
      ['haircut', '2:00', true],
      ['dinner', '5:00', false],
    ]);
    expect(t.nowIndex).toBe(3);
    // Feed all-day events before bills and holidays.
    expect(t.allDay.map(e => e.id)).toEqual(['no school', 'water']);
  });

  it('keeps an event in progress unfaded and hides the line before the first or after the last', () => {
    expect(todayTimeline(events, D, new Date(at(D, '14:30')), TZ).rows[2]?.past).toBe(false);
    expect(todayTimeline(events, D, new Date(at(D, '07:00')), TZ).nowIndex).toBeNull();
    expect(todayTimeline(events, D, new Date(at(D, '21:00')), TZ).nowIndex).toBeNull();
  });
});

describe('dueTodayChecklist', () => {
  const todo = (id: string, date: string, completedAt?: string): ToDo =>
    ({ id, text: id, completeByDate: date, isCompleted: !!completedAt, ...(completedAt ? { completedAt } : {}) }) as ToDo;

  it('keeps overdue, due today and ticked-off-today items', () => {
    const list = [
      todo('late', '2026-10-01'),
      todo('today', '2026-10-03'),
      todo('done today', '2026-10-03', '2026-10-03T20:00:00Z'),
      todo('done yesterday', '2026-10-02', '2026-10-02T20:00:00Z'),
      // 03:00 UTC on the 4th is still the 3rd in Chicago.
      todo('done late evening', '2026-10-02', '2026-10-04T03:00:00Z'),
      todo('later', '2026-10-05'),
    ];
    expect(dueTodayChecklist(list, '2026-10-03', TZ).map(t => t.id)).toEqual(['late', 'done late evening', 'done today', 'today']);
  });
});

describe('groupComingUp', () => {
  it('lists the next 14 days after today, skipping empty ones, with muted lines apart', () => {
    const events = [
      ev('today', '2026-10-03', at('2026-10-03', '09:00')),
      ev('market', '2026-10-04', at('2026-10-04', '10:00')),
      ev('water', '2026-10-05', undefined, undefined, { source: 'bill' }),
      ev('practice', '2026-10-05', at('2026-10-05', '15:30')),
      ev('orchard', '2026-10-10', at('2026-10-10', '13:00')),
      ev('cabin', '2026-10-11', at('2026-10-11', '09:00')),
      ev('marathon', '2026-10-17', at('2026-10-17', '09:00')),
      ev('too far', '2026-10-18', at('2026-10-18', '09:00')),
    ];
    const days = groupComingUp(events, '2026-10-03');
    expect(days.map(d => [d.date, d.weekday, d.dayOfMonth, d.rel])).toEqual([
      ['2026-10-04', 'Sun', 4, 'Tomorrow'],
      ['2026-10-05', 'Mon', 5, null],
      ['2026-10-10', 'Sat', 10, 'Next week'],
      ['2026-10-11', 'Sun', 11, null],
      ['2026-10-17', 'Sat', 17, null],
    ]);
    expect(days[1]?.muted.map(e => e.id)).toEqual(['water']);
    expect(days[1]?.events.map(e => e.id)).toEqual(['practice']);
  });

  it('handles 300 events without dropping any', () => {
    const many = Array.from({ length: 300 }, (_, i) => {
      const date = addDaysTo('2026-10-04', i % 14);
      return ev(`e${i}`, date, at(date, `${String(8 + (i % 12)).padStart(2, '0')}:00`));
    });
    const days = groupComingUp(many, '2026-10-03');
    expect(days).toHaveLength(14);
    expect(days.reduce((n, d) => n + d.events.length, 0)).toBe(300);
  });
});

describe('layoutDayBlocks', () => {
  const D = '2026-10-07';

  it('places events on the 7 am–10 pm grid and splits overlaps into columns', () => {
    const blocks = layoutDayBlocks(
      [
        ev('pickup', D, at(D, '12:45'), at(D, '13:15')),
        ev('practice', D, at(D, '15:30'), at(D, '17:00')),
        ev('ortho', D, at(D, '16:00'), at(D, '17:00')),
        ev('swim', D, at(D, '17:30'), at(D, '18:15')),
      ],
      D,
      TZ
    );
    const byId = Object.fromEntries(blocks.map(b => [b.event.id, b]));
    expect(byId['pickup']).toMatchObject({ top: 5.75, height: 0.5, col: 0, cols: 1 });
    expect(byId['practice']).toMatchObject({ top: 8.5, col: 0, cols: 2 });
    expect(byId['ortho']).toMatchObject({ top: 9, col: 1, cols: 2 });
    expect(byId['swim']).toMatchObject({ col: 0, cols: 1 });
  });

  it('clips events that cross the edges and leaves fully-outside ones to the strip', () => {
    const events = [
      ev('early', D, at(D, '05:00'), at(D, '08:00')),
      ev('late', D, at(D, '21:30'), at('2026-10-08', '01:00')),
      ev('red-eye', D, at(D, '23:00'), at('2026-10-08', '02:00')),
      ev('dawn run', D, at(D, '05:30'), at(D, '06:30')),
    ];
    const blocks = layoutDayBlocks(events, D, TZ);
    expect(blocks.map(b => b.event.id)).toEqual(['early', 'late']);
    expect(blocks[0]).toMatchObject({ top: 0, height: 1 });
    expect(blocks[1]).toMatchObject({ top: 14.5, height: 0.5 });
    expect(outsideDayHours(events, D, TZ).map(e => e.id)).toEqual(['dawn run', 'red-eye']);
  });
});

describe('monthCells', () => {
  it('builds Sunday-first weeks covering the month, three lines a day', () => {
    const events = [
      ev('a', '2026-10-07', at('2026-10-07', '12:00')),
      ev('b', '2026-10-07', at('2026-10-07', '15:00')),
      ev('c', '2026-10-07', at('2026-10-07', '16:00')),
      ev('d', '2026-10-07', at('2026-10-07', '17:00')),
      ev('phone', '2026-10-07', undefined, undefined, { source: 'bill' }),
    ];
    const cells = monthCells('2026-10-15', events, '2026-10-03');
    expect(cells).toHaveLength(35);
    expect(cells[0]).toMatchObject({ date: '2026-09-27', inMonth: false });
    expect(cells[34]).toMatchObject({ date: '2026-10-31', inMonth: true });
    expect(cells.find(c => c.isToday)?.date).toBe('2026-10-03');
    const wed = cells.find(c => c.date === '2026-10-07');
    expect(wed?.lines.map(e => e.id)).toEqual(['phone', 'a', 'b']);
    expect(wed?.more).toBe(2);
  });

  it('uses six weeks when the month needs them', () => {
    // August 2026 starts on a Saturday and has 31 days.
    expect(monthCells('2026-08-01', [], '2026-08-01')).toHaveLength(42);
    // February 2026 starts on a Sunday: exactly four weeks.
    expect(monthCells('2026-02-10', [], '2026-02-10')).toHaveLength(28);
  });
});
