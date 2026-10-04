/**
 * Fetching a calendar feed (docs/plans/wall-display-kiosk.md §4.5).
 *
 * Feed URLs are pasted by a household admin and fetched server-side, so the
 * same SSRF guard as the recipe importer applies (`assertFetchableUrl`).
 * Redirects are followed by hand so EVERY hop is checked, not only the final
 * URL. Conditional headers let an unchanged feed answer 304 and skip the
 * parse. A feed URL is a credential (a Google "secret address"): never log it.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { assertFetchableUrl } from "../../fetchRecipePage";

export const MAX_ICS_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

/** A feed problem worth showing to the admin, worded for them. */
export class FeedFetchError extends Error {}

/**
 * Normalizes a pasted calendar link: `webcal://` becomes `https://`, then the
 * SSRF guard runs. Throws `invalid-argument` (HttpsError) on a bad link.
 */
export function normalizeFeedUrl(raw: unknown): string {
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  const rewritten = typeof trimmed === "string" ? trimmed.replace(/^webcals?:\/\//i, "https://") : trimmed;
  try {
    return assertFetchableUrl(rewritten).toString();
  } catch (error) {
    if (error instanceof HttpsError) {
      throw new HttpsError("invalid-argument", "That doesn't look like a public calendar link.");
    }
    throw error;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type IcsFetchResult =
  | { status: "not-modified" }
  | { status: "ok"; text: string; etag?: string; lastModified?: string };

async function readCapped(response: Response, cap: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw new FeedFetchError("That calendar is too big (over 5 MB).");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

export async function fetchIcs(
  url: string,
  validators: { etag?: string; lastModified?: string } = {},
  fetchImpl: FetchLike = fetch
): Promise<IcsFetchResult> {
  const headers: Record<string, string> = {
    Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
    "User-Agent": "LifeBalance-Wall/1.0 (+calendar sync)",
  };
  if (validators.etag) headers["If-None-Match"] = validators.etag;
  if (validators.lastModified) headers["If-Modified-Since"] = validators.lastModified;

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response: Response;
    try {
      response = await fetchImpl(current, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new FeedFetchError("Couldn't reach that calendar. Check the link.");
    }

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      const location = response.headers.get("location");
      if (!location) throw new FeedFetchError("That calendar link redirects nowhere.");
      try {
        current = assertFetchableUrl(new URL(location, current).toString()).toString();
      } catch {
        throw new FeedFetchError("That calendar link redirects somewhere it can't be read from.");
      }
      continue;
    }
    if (response.status === 304) return { status: "not-modified" };
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new FeedFetchError("That calendar link no longer works. It may have been reset. Paste the new link.");
    }
    if (!response.ok) {
      throw new FeedFetchError(`The calendar server answered ${response.status}. It'll be retried.`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_ICS_BYTES) throw new FeedFetchError("That calendar is too big (over 5 MB).");
    const text = await readCapped(response, MAX_ICS_BYTES);
    const etag = response.headers.get("etag") ?? undefined;
    const lastModified = response.headers.get("last-modified") ?? undefined;
    return { status: "ok", text, ...(etag ? { etag } : {}), ...(lastModified ? { lastModified } : {}) };
  }
  throw new FeedFetchError("That calendar link redirects too many times.");
}
