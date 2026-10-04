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
