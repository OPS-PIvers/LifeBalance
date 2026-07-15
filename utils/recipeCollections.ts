import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Meal } from '@/types/schema';

/**
 * Smart collection predicates for the Cookbook (F-MEALS-08). Pure, unit-tested
 * filters over already-loaded `Meal[]` data — no schema or mutation changes.
 */

export type SmartCollectionId = 'not-cooked-30d' | 'never-tried' | 'favorites';

export interface SmartCollection {
  id: SmartCollectionId;
  label: string;
  predicate: (meal: Meal, today: string) => boolean;
}

/** "Not cooked in 30+ days": lastCooked older than 30 days, or absent entirely. */
export function isNotCookedIn30Days(meal: Meal, today: string): boolean {
  if (!meal.lastCooked) return true;
  const lastCookedDate = parseISO(meal.lastCooked);
  const todayDate = parseISO(today);
  if (Number.isNaN(lastCookedDate.getTime()) || Number.isNaN(todayDate.getTime())) return true;
  return differenceInCalendarDays(todayDate, lastCookedDate) >= 30;
}

/** "Never tried": no lastCooked date recorded at all. */
export function isNeverTried(meal: Meal): boolean {
  return !meal.lastCooked;
}

/** "5-star favorites" (owner-approved threshold: rating >= 4). */
export function isFavorite(meal: Meal): boolean {
  return (meal.rating ?? 0) >= 4;
}

export const SMART_COLLECTIONS: SmartCollection[] = [
  { id: 'not-cooked-30d', label: 'Not cooked in 30+ days', predicate: isNotCookedIn30Days },
  { id: 'never-tried', label: 'Never tried', predicate: (meal) => isNeverTried(meal) },
  { id: 'favorites', label: 'Favorites', predicate: (meal) => isFavorite(meal) },
];

export function getSmartCollection(id: SmartCollectionId): SmartCollection {
  const collection = SMART_COLLECTIONS.find((c) => c.id === id);
  if (!collection) {
    throw new Error(`Unknown smart collection id: ${id}`);
  }
  return collection;
}
