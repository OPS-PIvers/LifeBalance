import type { WallEvent, WallTravel } from '@/types/schema';

/**
 * When to leave for an event (docs/plans/wall-display-kiosk.md §12 "Alerts").
 * One rule for the Board's Now card, the alerts and the day brief:
 *
 * 1. A leave time the event states ("leave at 5:15") is the leave time.
 * 2. Otherwise start − trip − how early to arrive. The trip is the event's
 *    own (Apple's Travel Time, "20 min drive") or else the measured route;
 *    how early is the event's own ("arrive 15 min early") or else the wall's
 *    setting.
 * 3. Without any trip there is no leave time, but an event that says when to
 *    be there ("arrive by 4:45", "be there 15 min early") still has a time
 *    that matters more than its start: the plan is then that arrival time,
 *    with `kind: 'arrive'`. A calendar without travel alerts, or an event
 *    with no address, is most of a family calendar, so this is the common
 *    case for "arrive by", not the edge.
 *
 * The route alone would get you there exactly as it starts, which is never
 * when anyone means to arrive.
 */
export interface LeavePlan {
  /** 'leave': `at` is when to leave. 'arrive': no trip is known; `at` is when to be there. */
  kind: 'leave' | 'arrive';
  /** When to leave, or (kind 'arrive') when to be there (ms). */
  at: number;
  /** The trip in minutes, when one is known (for "20 min drive"). */
  travelMin: number | null;
}

const MIN = 60_000;

/** The measured route for this event, if it was measured for its current start. */
export function routeFor(event: WallEvent, travel: readonly WallTravel[] | ReadonlyMap<string, WallTravel>): number | null {
  const t = 'get' in travel ? travel.get(event.id) : travel.find(x => x.id === event.id);
  return t && t.start === event.start && t.minutes !== null ? t.minutes : null;
}

export function leavePlan(event: WallEvent, routeMin: number | null, defaultEarlyMin: number): LeavePlan | null {
  if (event.allDay || !event.start) return null;
  const start = Date.parse(event.start);
  if (Number.isNaN(start)) return null;
  const travelMin = event.travelMin ?? routeMin;
  const stated = event.leaveAt ? Date.parse(event.leaveAt) : NaN;
  if (Number.isFinite(stated) && stated < start) return { kind: 'leave', at: stated, travelMin };
  if (travelMin === null) {
    // Only the event's own word: the wall's arrive-early setting is a margin on a trip.
    return event.earlyMin != null && event.earlyMin > 0 ? { kind: 'arrive', at: start - event.earlyMin * MIN, travelMin: null } : null;
  }
  return { kind: 'leave', at: start - (travelMin + (event.earlyMin ?? defaultEarlyMin)) * MIN, travelMin };
}
