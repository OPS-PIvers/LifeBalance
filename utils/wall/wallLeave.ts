import type { WallEvent, WallTravel } from '@/types/schema';

/**
 * When to leave for an event (docs/plans/wall-display-kiosk.md §12 "Alerts").
 * One rule for the Board's Now card, the alerts and the day brief:
 *
 * 1. A leave time the event states ("leave at 5:15") is the leave time.
 * 2. Otherwise start − trip − how early to arrive. The trip is the event's
 *    own (Apple's Travel Time, "20 min drive") or else the measured route;
 *    how early is the event's own ("arrive 15 min early") or else the wall's
 *    setting. Without either trip there is no leave time.
 *
 * The route alone would get you there exactly as it starts, which is never
 * when anyone means to arrive.
 */
export interface LeavePlan {
  /** When to leave (ms). */
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
  if (Number.isFinite(stated) && stated < start) return { at: stated, travelMin };
  if (travelMin === null) return null;
  return { at: start - (travelMin + (event.earlyMin ?? defaultEarlyMin)) * MIN, travelMin };
}
