/**
 * Pure helpers for the `voicemisses` endpoint (./voiceMisses.ts): the
 * export shape of a wall voice miss, expiry, and the delete request.
 * See docs/DECISIONS.md "Voice misses".
 */

/** The most misses one GET returns, and one POST may delete. */
export const VOICE_MISS_PAGE = 500;

export interface ExportedVoiceMiss {
  id: string;
  kind: string;
  heard: string;
  free: string;
  alternative: string;
  engine: string;
  view: string;
  did: string | null;
  displayId: string;
  appVersion: string;
  at: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A stored `expireAt` (Firestore Timestamp) as epoch ms, or null. */
export function expiryMs(value: unknown): number | null {
  if (value && typeof value === "object") {
    const ts = value as { toMillis?: () => number };
    if (typeof ts.toMillis === "function") {
      const ms = ts.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
  }
  return null;
}

/** Past its TTL. The TTL policy deletes these within a day or so; the endpoint never returns one meanwhile. */
export function isExpired(data: Record<string, unknown>, nowMs: number): boolean {
  const ms = expiryMs(data.expireAt);
  return ms !== null && ms <= nowMs;
}

export function toExportedMiss(id: string, data: Record<string, unknown>): ExportedVoiceMiss {
  const did = str(data.did);
  return {
    id,
    kind: str(data.kind),
    heard: str(data.heard),
    free: str(data.free),
    alternative: str(data.alternative),
    engine: str(data.engine),
    view: str(data.view),
    did: did || null,
    displayId: str(data.displayId),
    appVersion: str(data.appVersion),
    at: str(data.at),
  };
}

/** Oldest first, so the routine reads them in the order they happened. */
export function sortMisses(misses: ExportedVoiceMiss[]): ExportedVoiceMiss[] {
  return [...misses].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));
}

/**
 * `{ "delete": ["id", …] }` → the ids to delete (deduplicated), or the reason
 * the body is unusable. Ids must be plain Firestore ids: a path can never
 * reach outside the key's own household's voiceMisses.
 */
export function parseDeleteBody(body: unknown): { ids: string[] } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object" };
  const raw = (body as { delete?: unknown }).delete;
  if (!Array.isArray(raw)) return { error: "`delete` must be an array of ids" };
  if (raw.length > VOICE_MISS_PAGE) return { error: `At most ${VOICE_MISS_PAGE} ids per request` };
  const ids = new Set<string>();
  for (const id of raw) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return { error: "Every id must be a Firestore document id" };
    ids.add(id);
  }
  return { ids: [...ids] };
}
