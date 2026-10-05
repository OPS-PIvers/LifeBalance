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

/**
 * One spoken phrase in a natural cloud voice (functions/src/wall/tts.ts
 * `walltts`), as base64 MP3. Members and the household's active display.
 */
export async function synthesizeWallSpeech(householdId: string, text: string): Promise<string> {
  const [{ httpsCallable }, functions] = await Promise.all([import('firebase/functions'), getFunctionsInstance()]);
  const tts = httpsCallable<{ householdId: string; text: string }, { audioContent: string }>(functions, 'walltts');
  const { data } = await tts({ householdId, text });
  return data.audioContent;
}
