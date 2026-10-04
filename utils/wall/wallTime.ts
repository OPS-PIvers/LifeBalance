/**
 * Clock and time formatting for the wall (docs/plans/wall-display-kiosk.md §3,
 * "Times"). All functions take the household's IANA zone so the wall shows the
 * family's time even if the iPad's own zone is set wrong.
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  weekday: string; // "Saturday"
  monthName: string; // "October"
}

export function zonedParts(date: Date, timeZone?: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  const month = Number(get('month'));
  return {
    year: Number(get('year')),
    month,
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: get('weekday'),
    monthName: new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, 1))),
  };
}

/** yyyy-MM-dd in the zone. */
export function zonedDateString(date: Date, timeZone?: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const hour12 = (hour: number) => (hour % 12 === 0 ? 12 : hour % 12);

/** The top-bar clock: "3:15", never am/pm. */
export function clockText(hour: number, minute: number): string {
  return `${hour12(hour)}:${String(minute).padStart(2, '0')}`;
}

/**
 * Event times: "3:30", with "am"/"pm" only before 7 am and from 9 pm on, where
 * an unmarked time would be ambiguous ("6:00" could be either).
 */
export function wallTimeText(hour: number, minute: number): string {
  const base = clockText(hour, minute);
  if (hour < 7) return `${base} am`;
  if (hour >= 21) return `${base} pm`;
  return base;
}

/** "6 pm", "11 am": hour labels for the weather rain note. */
export function hourLabel(hour: number): string {
  return `${hour12(hour)} ${hour < 12 ? 'am' : 'pm'}`;
}
