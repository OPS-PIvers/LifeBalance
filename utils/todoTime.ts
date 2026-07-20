// F-TODO-14 — pure helpers for the optional due time + reminder offset on
// to-dos. Kept as a tiny unit-tested module (like utils/todoRecurrence.ts) so
// ToDosPage/TodoRow stay presentational and the sort rule has one home.

import type { ToDo } from '@/types/schema';

/** Reminder lead-time presets, in minutes before the due time. */
export const REMINDER_OFFSET_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: 'At due time' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
] as const;

/** Strict HH:mm (24-hour) validator for the stored dueTime string. */
export function isValidDueTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** '15:00' -> '3:00 PM'. Returns null for absent/malformed input. */
export function formatDueTime(dueTime: string | undefined): string | null {
  if (!isValidDueTime(dueTime)) return null;
  const [hStr, mStr] = dueTime.split(':');
  const hour = Number(hStr);
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${mStr} ${period}`;
}

/**
 * Within-day tiebreaker: timed to-dos sort by their time, ahead of untimed
 * ones. Returns 0 when neither has a (valid) time so callers can keep their
 * existing stable order.
 */
export function compareDueTimes(a: ToDo, b: ToDo): number {
  const at = isValidDueTime(a.dueTime) ? a.dueTime : null;
  const bt = isValidDueTime(b.dueTime) ? b.dueTime : null;
  if (at === null && bt === null) return 0;
  if (at === null) return 1;
  if (bt === null) return -1;
  return at.localeCompare(bt);
}
