import { describe, expect, it } from 'vitest';
import {
  currentWeekRange,
  isoWeekIdForDate,
  lastClosedWeekRange,
  pastClosedWeeks,
  weekRangeForIsoWeek,
} from '@/utils/recapWeek';

/**
 * 🛡️ FIXTURES ARE ANCHORED TO THEIR OWN WEEK, never to an offset from "today"
 * — see `utils/recapAssembly.test.ts`'s identical warning. Mon 2026-06-29 →
 * Sun 2026-07-05 is ISO week 2026-W27, matching that file's own constants.
 */
const MON = '2026-06-29';
const WED = '2026-07-01';
const SUN = '2026-07-05';
const NEXT_MON = '2026-07-06'; // first day of the following week (2026-W28)

describe('isoWeekIdForDate', () => {
  it('resolves a plain local date to its ISO week', () => {
    expect(isoWeekIdForDate(MON)).toBe('2026-W27');
    expect(isoWeekIdForDate(WED)).toBe('2026-W27');
    expect(isoWeekIdForDate(SUN)).toBe('2026-W27');
  });

  it('crosses the ISO week-year boundary correctly', () => {
    // isoWeekStartDate('2026-W01') resolves to 2025-12-29 (Monday) — the
    // classic ISO-week-year edge case. The round trip must agree.
    expect(isoWeekIdForDate('2025-12-29')).toBe('2026-W01');
  });
});

describe('weekRangeForIsoWeek', () => {
  it('resolves an ISO week id to its Monday/Sunday bounds', () => {
    expect(weekRangeForIsoWeek('2026-W27')).toEqual({
      isoWeek: '2026-W27',
      weekStart: MON,
      weekEnd: SUN,
    });
  });

  it('returns null for a malformed/out-of-range id', () => {
    expect(weekRangeForIsoWeek('2026-W60')).toBeNull();
    expect(weekRangeForIsoWeek('not-a-week')).toBeNull();
  });
});

describe('currentWeekRange', () => {
  it('resolves to the week containing `today`, regardless of which day of it', () => {
    expect(currentWeekRange(MON)).toEqual({ isoWeek: '2026-W27', weekStart: MON, weekEnd: SUN });
    expect(currentWeekRange(WED)).toEqual({ isoWeek: '2026-W27', weekStart: MON, weekEnd: SUN });
    expect(currentWeekRange(SUN)).toEqual({ isoWeek: '2026-W27', weekStart: MON, weekEnd: SUN });
  });
});

describe('lastClosedWeekRange', () => {
  it('resolves to the week BEFORE "today"\'s week (2026-W27), no matter which day of 2026-W28 "today" is', () => {
    const expected = { isoWeek: '2026-W27', weekStart: MON, weekEnd: SUN };
    // The Monday the new week (2026-W28) opens...
    expect(lastClosedWeekRange(NEXT_MON)).toEqual(expected);
    // ...and a mid-week day of that SAME new week — both must agree, since
    // "the first app open after a week closes" can land on any day of it.
    expect(lastClosedWeekRange('2026-07-08')).toEqual(expected);
  });

  it('also resolves correctly from WITHIN the week itself (one week further back)', () => {
    // "Today" mid-week in 2026-W27 → the week that closed before IT is W26.
    expect(lastClosedWeekRange(WED)).toEqual({
      isoWeek: '2026-W26',
      weekStart: '2026-06-22',
      weekEnd: '2026-06-28',
    });
  });
});

describe('pastClosedWeeks', () => {
  it('returns the requested count of CLOSED weeks, newest first, stepping back 7 days at a time', () => {
    expect(pastClosedWeeks(3, NEXT_MON)).toEqual([
      { isoWeek: '2026-W27', weekStart: '2026-06-29', weekEnd: '2026-07-05' },
      { isoWeek: '2026-W26', weekStart: '2026-06-22', weekEnd: '2026-06-28' },
      { isoWeek: '2026-W25', weekStart: '2026-06-15', weekEnd: '2026-06-21' },
    ]);
  });

  it('never includes the in-progress week', () => {
    const weeks = pastClosedWeeks(5, NEXT_MON);
    expect(weeks.every(w => w.isoWeek !== '2026-W28')).toBe(true);
  });
});
