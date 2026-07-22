import { Habit } from '@/types/schema';
import { GeoPoint, isWithinRadius, shouldPromptLocation } from '@/utils/habitGeoTrigger';

/**
 * Habit Automations (PRD #1065) — the pure decision layer for the foreground
 * geo check-in. `useHabitLocationPrompt` does the side effects (ONE
 * geolocation read on app open, localStorage-backed daily dedup); this module
 * turns `(habits, position, promptedKeys)` into the list of matches eligible
 * for a confirm-prompt banner, in habit/location declaration order.
 *
 * Pure — no geolocation API, no clock, no localStorage.
 */

export interface HabitLocationMatch {
  habitId: string;
  habitTitle: string;
  locationId: string;
  locationName: string;
}

/**
 * Every (habit, saved location) pair whose radius contains `current` and
 * hasn't already been prompted today per `promptedKeys` (see
 * `shouldPromptLocation` — the once-per-day-per-location dedup rule). Habits
 * without `triggers.locations` are skipped entirely.
 */
export function findLocationMatches(
  habits: readonly Habit[],
  current: GeoPoint,
  today: string,
  promptedKeys: readonly string[],
): HabitLocationMatch[] {
  const matches: HabitLocationMatch[] = [];
  for (const habit of habits) {
    const locations = habit.triggers?.locations ?? [];
    for (const location of locations) {
      if (isWithinRadius(current, location) && shouldPromptLocation(location, today, promptedKeys)) {
        matches.push({
          habitId: habit.id,
          habitTitle: habit.title,
          locationId: location.id,
          locationName: location.name,
        });
      }
    }
  }
  return matches;
}
