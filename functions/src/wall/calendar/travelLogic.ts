/**
 * Pure rules for the wall's travel times (docs/plans/wall-display-kiosk.md
 * §12 "Alerts"): which events get a route, when to ask Google Routes, and the
 * request/response shapes.
 */

export type TravelMode = "drive" | "walk" | "bike" | "transit";
export const TRAVEL_MODES: readonly TravelMode[] = ["drive", "walk", "bike", "transit"];

/** First lookup this far ahead of an event's start. */
export const TRAVEL_LOOKAHEAD_MS = 4 * 60 * 60 * 1000;
/** Look again (for traffic) once the event is this close, if the last look was earlier. */
export const TRAVEL_RECHECK_MS = 95 * 60 * 1000;
export const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const HOME_SECRET_ID = "_home";
const ADDRESS_MAX = 200;

/** A home address as typed, tidied; null when empty or too long. */
export function homeAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.replace(/\s+/g, " ").trim();
  return a && a.length <= ADDRESS_MAX ? a : null;
}

export function travelModeOf(raw: unknown): TravelMode {
  return TRAVEL_MODES.find((m) => m === raw) ?? "drive";
}

/** Video calls, links and "TBD" aren't places you drive to. */
export function routableLocation(location: string | undefined): string | null {
  const loc = (location ?? "").replace(/\s+/g, " ").trim();
  if (loc.length < 4 || loc.length > 300) return null;
  if (/https?:\/\/|www\.|\.com\/|zoom|meet\.google|teams\.microsoft|microsoft teams|google meet|webex|facetime|^(tbd|tba|online|virtual|remote|phone|call|home)$/i.test(loc)) {
    return null;
  }
  return loc;
}

/** Ask Routes for this event now? Once ~4 h out, then once more inside ~95 min. */
export function needsTravelCheck(startMs: number, nowMs: number, lastCheckedMs: number | null): boolean {
  const ahead = startMs - nowMs;
  if (ahead <= 0 || ahead > TRAVEL_LOOKAHEAD_MS) return false;
  if (lastCheckedMs === null) return true;
  return ahead <= TRAVEL_RECHECK_MS && startMs - lastCheckedMs > TRAVEL_RECHECK_MS;
}

const ROUTES_MODE: Record<TravelMode, string> = { drive: "DRIVE", walk: "WALK", bike: "BICYCLE", transit: "TRANSIT" };

export function routesRequestBody(origin: string, destination: string, mode: TravelMode, startIso: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: ROUTES_MODE[mode],
  };
  // Live traffic for driving (departing now); transit plans to arrive on time.
  if (mode === "drive") body.routingPreference = "TRAFFIC_AWARE";
  if (mode === "transit") body.arrivalTime = startIso;
  return body;
}

/** "1234s" → whole minutes (rounded up); null when there's no route. */
export function routeMinutes(response: unknown): number | null {
  const routes = (response as { routes?: { duration?: unknown }[] } | null)?.routes;
  const duration = routes?.[0]?.duration;
  if (typeof duration !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!m) return null;
  return Math.max(1, Math.ceil(Number(m[1]) / 60));
}
