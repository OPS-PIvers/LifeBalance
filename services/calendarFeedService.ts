/**
 * Client service for the household calendar ICS feed (Plan 22).
 *
 * The token itself is generated and stored server-side by the
 * `generatecalendarfeedtoken` callable (see functions/src/calendarFeed.ts) —
 * this module only invokes that callable and builds the subscription URL.
 * The token then reaches the client normally through the existing household
 * Firestore listener (`Household.calendarFeedToken`), no extra plumbing
 * needed.
 */

import { getFunctionsInstance } from "@/firebase.config";

interface GenerateCalendarFeedTokenResult {
  token: string;
}

/**
 * Call the `generatecalendarfeedtoken` callable to mint (or rotate) the
 * household's calendar feed token. The new token is written to the household
 * doc server-side and arrives back on the client via the normal Firestore
 * listener — the return value here is only needed to build the URL to show
 * immediately, without waiting on the listener round-trip.
 */
export async function generateCalendarFeedToken(
  householdId: string
): Promise<string> {
  const [{ httpsCallable }, functions] = await Promise.all([
    import("firebase/functions"),
    getFunctionsInstance(),
  ]);
  const fn = httpsCallable<
    { householdId: string },
    GenerateCalendarFeedTokenResult
  >(functions, "generatecalendarfeedtoken");
  const result = await fn({ householdId });
  return result.data.token;
}

/** Base URL for the `calendarfeed` HTTP Cloud Function (same project/region as Quick Add). */
function getCalendarFeedBaseUrl(): string {
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "lifebalance-26080";
  return `https://us-central1-${projectId}.cloudfunctions.net/calendarfeed`;
}

/**
 * Build the subscribable feed URL for a household + token. Uses the
 * `webcal://` scheme so tapping the link on iOS/Android offers "Subscribe to
 * Calendar" directly; calendar apps that don't understand `webcal://` treat
 * it as `https://` for the same host+path.
 */
export function getCalendarFeedUrl(householdId: string, token: string): string {
  const base = getCalendarFeedBaseUrl().replace(/^https:\/\//, "webcal://");
  return `${base}?hid=${encodeURIComponent(householdId)}&token=${encodeURIComponent(token)}`;
}
