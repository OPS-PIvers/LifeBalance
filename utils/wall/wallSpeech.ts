/**
 * Words the wall says out loud (docs/plans/wall-display-kiosk.md §12
 * "Sound"). Written for the ear: short, no symbols, nothing a speech engine
 * would read as punctuation.
 */

/** "milk", "milk and eggs", "milk, eggs and bread", "milk, eggs, bread and 2 more". */
export function spokenList(items: readonly string[], max = 3): string {
  const names = items.map(s => s.trim()).filter(Boolean);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length > max + 1) {
    const rest = names.length - max;
    return `${names.slice(0, max).join(', ')} and ${rest} more`;
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "today", "tomorrow", or "Friday, October 9" for a yyyy-MM-dd date. */
export function spokenDay(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** "4 PM", "4:30 PM" for an ISO instant in the wall's zone. */
export function spokenTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone }).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value ?? '';
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  const period = (parts.find(p => p.type === 'dayPeriod')?.value ?? '').toUpperCase();
  return `${hour}${minute === '00' ? '' : `:${minute}`} ${period}`.trim();
}

/** "1 minute", "25 minutes", "1 hour 10 minutes". */
export function spokenDuration(minutes: number): string {
  const m = Math.max(1, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const mins = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;
  if (h === 0) return mins(m);
  const hours = `${h} hour${h === 1 ? '' : 's'}`;
  return rest === 0 ? hours : `${hours} ${mins(rest)}`;
}
