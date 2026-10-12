import { describe, expect, it } from 'vitest';
import type { WallCalendarFeed, WallEvent, WallTravel } from '@/types/schema';
import { ALERT_GRACE_MS, alertWords, dueAlert, planAlerts } from './wallAlerts';

const MIN = 60_000;
const START = '2026-10-05T16:30:00-05:00';
const startMs = Date.parse(START);
const TZ = 'America/Chicago';

const ev = (over: Partial<WallEvent> = {}): WallEvent => ({
  id: 'piano',
  source: 'feed',
  feedId: 'kids',
  ownerKey: 'leo',
  title: 'Piano lesson',
  allDay: false,
  date: '2026-10-05',
  start: START,
  location: 'Lakeside Music',
  ...over,
});
const feed = (over: Partial<WallCalendarFeed> = {}): WallCalendarFeed => ({
  id: 'kids',
  label: 'Kids',
  ownerKey: 'family',
  kind: 'ics',
  createdBy: 'u',
  eventCount: 1,
  stale: false,
  alerts: true,
  ...over,
});
const trip = (minutes: number | null, over: Partial<WallTravel> = {}): WallTravel => ({ id: 'piano', minutes, mode: 'drive', start: START, checkedAt: '', ...over });

describe('planAlerts', () => {
  it('gives a heads-up and a leave alert when there is a travel time', () => {
    const plans = planAlerts([ev()], [feed()], [trip(20)], 10, 0);
    expect(plans.map(p => [p.kind, (startMs - p.at) / MIN])).toEqual([
      ['heads-up', 30],
      ['leave', 20],
    ]);
  });

  it('leaves early enough to arrive the set minutes early', () => {
    const plans = planAlerts([ev()], [feed()], [trip(20)], 10, 10);
    expect(plans.map(p => [p.kind, (startMs - p.at) / MIN])).toEqual([
      ['heads-up', 40],
      ['leave', 30],
    ]);
  });

  it("follows the event's own word: a set leave time, its own trip, its own arrive-early", () => {
    const at = (e: Partial<WallEvent>, t: WallTravel[] = [trip(20)]) =>
      planAlerts([ev(e)], [feed()], t, 10, 10).filter(p => p.kind === 'leave').map(p => (startMs - p.at) / MIN);
    expect(at({ leaveAt: '2026-10-05T15:45:00-05:00' })).toEqual([45]);
    expect(at({ travelMin: 35 })).toEqual([45]);
    expect(at({ earlyMin: 0 })).toEqual([20]);
    expect(at({ travelMin: 15, earlyMin: 5 }, [])).toEqual([20]);
    // A stated leave time after the start is no leave time at all.
    expect(at({ leaveAt: '2026-10-05T17:00:00-05:00' })).toEqual([30]);
  });

  it('falls back to one alert at the lead time without a usable travel time', () => {
    expect(planAlerts([ev()], [feed()], [], 15, 0).map(p => [p.kind, (startMs - p.at) / MIN])).toEqual([['soon', 15]]);
    expect(planAlerts([ev()], [feed()], [trip(null)], 10, 0).map(p => p.kind)).toEqual(['soon']);
    // Measured for the old start time: ignored.
    expect(planAlerts([ev()], [feed()], [trip(20, { start: '2026-10-05T15:00:00-05:00' })], 10, 0).map(p => p.kind)).toEqual(['soon']);
  });

  it('only for timed feed events on calendars with alerts on', () => {
    expect(planAlerts([ev()], [feed({ alerts: false })], [], 10, 0)).toEqual([]);
    expect(planAlerts([ev({ allDay: true, start: undefined })], [feed()], [], 10, 0)).toEqual([]);
    expect(planAlerts([ev({ source: 'bill', feedId: undefined })], [feed()], [], 10, 0)).toEqual([]);
  });
});

describe('dueAlert', () => {
  const plans = planAlerts([ev()], [feed()], [trip(20)], 10, 0);
  const headsUp = startMs - 30 * MIN;

  it('fires at its minute, once', () => {
    expect(dueAlert(plans, headsUp - MIN, new Set())).toBeNull();
    const a = dueAlert(plans, headsUp, new Set());
    expect(a?.kind).toBe('heads-up');
    expect(dueAlert(plans, headsUp + MIN, new Set([a!.key]))).toBeNull();
  });

  it('skips stale ones and prefers "leave" when both are due', () => {
    expect(dueAlert(plans, headsUp + ALERT_GRACE_MS + MIN, new Set())).toBeNull();
    expect(dueAlert(plans, startMs - 18 * MIN, new Set())?.kind).toBe('leave');
    expect(dueAlert(plans, startMs, new Set())).toBeNull();
  });
});

describe('alertWords', () => {
  const [headsUp, leave] = planAlerts([ev()], [feed()], [trip(20)], 10, 0);

  it('says when to leave and how far it is', () => {
    expect(alertWords(headsUp!, headsUp!.at, TZ, 'Leo')).toEqual({
      kicker: 'Leave in 10 min',
      title: 'Piano lesson',
      detail: '4:30 PM · Leo · 20 min drive',
      leaveBy: 'Leave by 4:10 PM',
      speech: "Leo, piano lesson at 4:30 PM. Leave in 10 minutes. It's a 20 minute drive.",
    });
    expect(alertWords(leave!, leave!.at, TZ, null).speech).toBe("Time to leave for piano lesson. It's a 20 minute drive.");
  });

  it('says when to leave without a trip when the event only states a time', () => {
    const [h, l] = planAlerts([ev({ location: undefined, leaveAt: '2026-10-05T16:00:00-05:00' })], [feed()], [], 10, 10);
    expect(alertWords(h!, h!.at, TZ, 'Leo')).toMatchObject({ detail: '4:30 PM · Leo', leaveBy: 'Leave by 4 PM', speech: 'Leo, piano lesson at 4:30 PM. Leave in 10 minutes.' });
    expect(alertWords(l!, l!.at, TZ, null).speech).toBe('Time to leave for piano lesson.');
  });

  it('counts down to the start without travel', () => {
    const [soon] = planAlerts([ev()], [feed({ travelMode: 'walk' })], [], 10, 0);
    expect(alertWords(soon!, soon!.at, TZ, null)).toMatchObject({ kicker: 'Starts in 10 min', detail: '4:30 PM', speech: 'Piano lesson starts in 10 minutes.' });
  });
});
