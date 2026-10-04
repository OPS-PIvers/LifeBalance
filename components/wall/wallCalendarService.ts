import { getFunctionsInstance } from '@/firebase.config';

/**
 * Asks the server to re-sync this household's wall calendars now
 * (functions/src/wall/calendar/functions.ts `syncwallcalendarsnow`). Allowed
 * for members and for the household's active display, once per 2 minutes.
 */
export async function syncWallCalendarsNow(householdId: string): Promise<{ failed: number }> {
  const [{ httpsCallable }, functions] = await Promise.all([import('firebase/functions'), getFunctionsInstance()]);
  const sync = httpsCallable<{ householdId: string }, { ok: true; failed: number }>(functions, 'syncwallcalendarsnow');
  const { data } = await sync({ householdId });
  return { failed: data.failed };
}
