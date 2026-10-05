/**
 * Pure helpers for phone Settings → Wall display
 * (docs/plans/wall-display-kiosk.md §5).
 */

/** "Last seen" turns red after this. */
export const DISPLAY_STALE_MS = 30 * 60 * 1000;

export function lastSeenText(lastSeenAt: string | undefined, now: number): { text: string; stale: boolean } {
  if (!lastSeenAt) return { text: 'Not seen yet', stale: true };
  const ms = now - new Date(lastSeenAt).getTime();
  const stale = ms > DISPLAY_STALE_MS;
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return { text: 'Last seen just now', stale };
  if (min < 60) return { text: `Last seen ${min} min ago`, stale };
  const hours = Math.round(min / 60);
  if (hours < 48) return { text: `Last seen ${hours} h ago`, stale };
  return { text: `Last seen ${Math.round(hours / 24)} days ago`, stale };
}

/** "482 913" */
export function formatPairingCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** "9:41" left until expiry, or null once expired. */
export function countdownText(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return null;
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

export function geocodeUrl(query: string): string {
  const params = new URLSearchParams({ name: query.trim(), count: '5', language: 'en', format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
}

/** Open-Meteo geocoding → "Orono, Minnesota, US" rows. */
export function parseGeocode(raw: unknown): GeocodeResult[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((r): GeocodeResult[] => {
    if (typeof r !== 'object' || r === null) return [];
    const { name, latitude, longitude, admin1, country_code } = r as Record<string, unknown>;
    if (typeof name !== 'string' || typeof latitude !== 'number' || typeof longitude !== 'number') return [];
    const parts = [name, typeof admin1 === 'string' ? admin1 : null, typeof country_code === 'string' ? country_code : null];
    return [{ label: parts.filter(Boolean).join(', '), lat: latitude, lon: longitude }];
  });
}

function agoText(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

export interface FeedStatus {
  text: string;
  tone: 'ok' | 'error' | 'stale';
}

/** The status line under a calendar in Settings → Wall display → Calendars. */
export function feedStatus(
  feed: { lastSyncAt?: string; lastSuccessAt?: string; createdAt?: string; lastError?: string; eventCount: number; stale: boolean; truncated?: boolean },
  now: number
): FeedStatus {
  if (feed.stale) {
    const since = feed.lastSuccessAt ?? feed.createdAt;
    const when = since ? new Date(since).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'it was added';
    return { text: `Hasn't updated since ${when} · re-paste the link`, tone: 'stale' };
  }
  if (feed.lastError) return { text: feed.lastError, tone: 'error' };
  if (!feed.lastSyncAt) return { text: 'Waiting for its first sync', tone: 'ok' };
  const count = `${feed.eventCount} ${feed.eventCount === 1 ? 'event' : 'events'}${feed.truncated ? ' (showing the nearest)' : ''}`;
  return { text: `${count} · synced ${agoText(feed.lastSuccessAt ?? feed.lastSyncAt, now)}`, tone: 'ok' };
}

/** File → base64, for a custom wake word's .ppn (a few KB). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
