import { describe, expect, it } from 'vitest';
import { spokenDay, spokenDuration, spokenList, spokenTime } from './wallSpeech';

describe('spokenList', () => {
  it('joins with commas and "and"', () => {
    expect(spokenList([])).toBe('');
    expect(spokenList(['milk'])).toBe('milk');
    expect(spokenList(['milk', 'eggs'])).toBe('milk and eggs');
    expect(spokenList(['milk', 'eggs', 'bread'])).toBe('milk, eggs and bread');
    expect(spokenList(['milk', 'eggs', 'bread', 'jam'])).toBe('milk, eggs, bread and jam');
  });

  it('counts the rest past the limit', () => {
    expect(spokenList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });
});

describe('spokenDay', () => {
  it('says today, tomorrow, or the weekday and date', () => {
    expect(spokenDay('2026-10-05', '2026-10-05', '2026-10-06')).toBe('today');
    expect(spokenDay('2026-10-06', '2026-10-05', '2026-10-06')).toBe('tomorrow');
    expect(spokenDay('2026-10-09', '2026-10-05', '2026-10-06')).toBe('Friday, October 9');
  });
});

describe('spokenTime', () => {
  it('drops ":00" and uses the wall zone', () => {
    expect(spokenTime('2026-10-05T21:00:00Z', 'America/Chicago')).toBe('4 PM');
    expect(spokenTime('2026-10-05T14:30:00Z', 'America/Chicago')).toBe('9:30 AM');
    expect(spokenTime('nope', 'America/Chicago')).toBe('');
  });
});

describe('spokenDuration', () => {
  it('reads minutes and hours', () => {
    expect(spokenDuration(1)).toBe('1 minute');
    expect(spokenDuration(24.6)).toBe('25 minutes');
    expect(spokenDuration(60)).toBe('1 hour');
    expect(spokenDuration(70)).toBe('1 hour 10 minutes');
    expect(spokenDuration(125)).toBe('2 hours 5 minutes');
  });
});
