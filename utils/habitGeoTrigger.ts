import { HabitLocationTrigger } from '@/types/schema';
import { triggerDedupKey } from '@/utils/habitTriggers';

/**
 * Habit Automations (PRD #1065) — geolocation trigger math.
 *
 * On app open the client takes ONE geolocation read and tests it against a
 * habit's saved locations. Being inside a location's radius surfaces a confirm
 * prompt ("You're at Target — log it?") — never a silent auto-log — and only
 * once per day per location. This module holds the pure geometry + dedup
 * decision; the foreground hook / banner and the actual fire live in later PRs.
 *
 * Pure functions only — no geolocation API, no clock, no side effects.
 */

const EARTH_RADIUS_METERS = 6_371_000;

export interface GeoPoint {
  lat: number;
  lng: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two points in meters (haversine formula).
 * Symmetric; returns 0 for identical points.
 */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is the current point within (inclusive of) the location's radius?
 * A point exactly on the radius edge counts as inside.
 */
export function isWithinRadius(
  current: GeoPoint,
  location: HabitLocationTrigger,
): boolean {
  return haversineMeters(current, location) <= location.radiusMeters;
}

/**
 * All saved locations whose radius contains the current point. Input order is
 * preserved. Returns a new array.
 */
export function locationsContainingPoint(
  current: GeoPoint,
  locations: HabitLocationTrigger[],
): HabitLocationTrigger[] {
  return locations.filter(location => isWithinRadius(current, location));
}

/**
 * Should we surface the confirm prompt for this location today? True only when
 * its dedup key has not already been recorded for `date`. The dedup key
 * itself (once per day per location) is owned by `triggerDedupKey` in
 * utils/habitTriggers.ts — this delegates rather than re-deriving the format,
 * so the two can never drift.
 */
export function shouldPromptLocation(
  location: HabitLocationTrigger,
  date: string,
  promptedKeys: readonly string[],
): boolean {
  const key = triggerDedupKey({ type: 'geo', locationId: location.id, label: location.name }, date);
  return key === null || !promptedKeys.includes(key);
}
