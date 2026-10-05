import { describe, expect, it } from 'vitest';
import type { WallEvent } from '@/types/schema';
import type { WallWeather } from './wallWeather';
import { briefDayFor, composeBrief } from './wallBrief';

const TZ = 'America/Chicago';
const TODAY = '2026-10-05';
const TOMORROW = '2026-10-06';
const NOW = Date.parse('2026-10-05T12:00:00-05:00');

const ev = (id: string, title: string, start: string | null, over: Partial<WallEvent> = {}): WallEvent => ({
  id,
  source: 'feed',
  ownerKey: 'family',
  title,
  allDay: start === null,
  date: (start ?? TODAY).slice(0, 10),
  ...(start ? { start, end: new Date(Date.parse(start) + 3600_000).toISOString() } : {}),
  ...over,
});

const weather: WallWeather = {
  fetchedAt: 0,
  current: { temp: 54, icon: 'partly' },
  high: 61,
  low: 43,
  blocks: [],
  rainNote: 'Rain likely 6–8 pm',
  days: [{ date: TOMORROW, high: 58, low: 41, icon: 'rain', precipMax: 80 }],
};

const person = (k: string) => (k === 'leo' ? 'Leo' : null);

describe('briefDayFor', () => {
  it('means tomorrow in the evening', () => {
    expect(briefDayFor('auto', 9)).toBe('today');
    expect(briefDayFor('auto', 18)).toBe('tomorrow');
    expect(briefDayFor('today', 21)).toBe('today');
  });
});

describe('composeBrief', () => {
  const events = [
    ev('a', 'Farmers market', '2026-10-05T09:00:00-05:00'),
    ev('b', 'Piano lesson', '2026-10-05T16:30:00-05:00', { ownerKey: 'leo' }),
    ev('c', 'Dinner at Grandma’s', '2026-10-05T17:00:00-05:00'),
    ev('d', 'Water bill', null, { source: 'bill' }),
    ev('e', 'Dentist', '2026-10-06T08:00:00-05:00', { ownerKey: 'leo' }),
  ];
  const travel = [{ id: 'b', minutes: 20, mode: 'drive' as const, start: '2026-10-05T16:30:00-05:00', checkedAt: '' }];

  it('reads today: weather, what’s left, bills, and leave-by times', () => {
    const brief = composeBrief({ day: 'today', date: TODAY, events, travel, weather, now: NOW, timeZone: TZ, person });
    expect(brief.lines.map(l => l.speech)).toEqual([
      "It's 54 degrees and partly cloudy, with a high of 61. Rain likely 6 to 8 pm.",
      'You have 2 things left today.',
      'The water bill is due.',
      'At 4:30 PM, Leo has piano lesson. Leave by 4:10 PM.',
      'At 5 PM, dinner at Grandma’s.',
    ]);
    expect(brief.lines[3]).toMatchObject({ text: '4:30 PM · Piano lesson · Leo · leave by 4:10 PM', ownerKey: 'leo' });
  });

  it('reads tomorrow with its forecast', () => {
    const brief = composeBrief({ day: 'tomorrow', date: TOMORROW, events, travel, weather, now: NOW, timeZone: TZ, person });
    expect(brief.lines.map(l => l.speech)).toEqual([
      "Tomorrow looks rainy, with a high of 58 and a low of 41. There's an 80 percent chance of rain.",
      'You have 1 thing tomorrow.',
      'At 8 AM, Leo has dentist.',
    ]);
  });

  it('says so when the day is empty, and works without weather', () => {
    const brief = composeBrief({ day: 'today', date: TODAY, events: [], travel: [], weather: null, now: NOW, timeZone: TZ, person });
    expect(brief.lines).toEqual([{ kind: 'count', text: 'Nothing else on the calendar today', speech: 'Nothing else is on the calendar today.' }]);
  });

  it('caps a busy day', () => {
    const many = Array.from({ length: 11 }, (_, i) => ev(`m${i}`, `Thing ${i}`, `2026-10-06T${String(8 + i).padStart(2, '0')}:00:00-05:00`));
    const brief = composeBrief({ day: 'tomorrow', date: TOMORROW, events: many, travel: [], weather: null, now: NOW, timeZone: TZ, person });
    expect(brief.lines.filter(l => l.kind === 'event')).toHaveLength(8);
    expect(brief.lines.at(-1)?.text).toBe('and 3 more');
  });
});
