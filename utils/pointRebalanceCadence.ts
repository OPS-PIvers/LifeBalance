/**
 * F-DASH-08 — Point-rebalance nudge cadence.
 *
 * Pure helpers deciding whether a habit's point-rebalance suggestion is still
 * "fresh" (not applied/dismissed within the cooldown window) plus the
 * localStorage key/read/write for per-habit dismissal timestamps. Mirrors the
 * `WeeklyRecapCard` per-week localStorage-dismiss pattern rather than adding a
 * new Firestore field — this is single-device UX polish, not data that needs
 * to sync across a household's devices.
 */

/** Don't re-offer a rebalance for the same habit within this many days. */
export const REBALANCE_COOLDOWN_DAYS = 30;

const STORAGE_PREFIX = 'lb_point_rebalance_last_';

export const rebalanceStorageKey = (habitId: string): string => `${STORAGE_PREFIX}${habitId}`;

/**
 * Whether `habitId` is eligible to be suggested again, given a map of
 * habitId -> last-reviewed ISO timestamp (as read from localStorage) and the
 * current time. Pure — no I/O — so the localStorage read/write live at the
 * call site and this stays trivially testable.
 */
export function isRebalanceEligible(
  habitId: string,
  lastReviewedAt: Record<string, string | undefined>,
  now: Date = new Date()
): boolean {
  const last = lastReviewedAt[habitId];
  if (!last) return true;
  const lastMs = new Date(last).getTime();
  if (!Number.isFinite(lastMs)) return true;
  const ageMs = now.getTime() - lastMs;
  if (ageMs < 0) return true; // clock skew / future timestamp — don't hide it forever
  return ageMs >= REBALANCE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

/** Read every stored last-reviewed timestamp for the given habit ids. */
export function readRebalanceCooldowns(habitIds: string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const id of habitIds) {
    try {
      result[id] = window.localStorage.getItem(rebalanceStorageKey(id)) ?? undefined;
    } catch {
      result[id] = undefined;
    }
  }
  return result;
}

/** Persist "reviewed" (applied or dismissed) for a habit at the given time. */
export function persistRebalanceReviewed(habitId: string, now: Date = new Date()): void {
  try {
    window.localStorage.setItem(rebalanceStorageKey(habitId), now.toISOString());
  } catch {
    // Best-effort — worst case the same suggestion reappears next session.
  }
}

// ---------------------------------------------------------------------------
// Analysis result cache — avoids calling `analyzeHabitPoints` (an AI/quota
// call) on every Dashboard mount. One cached result per household, reused for
// ANALYSIS_CACHE_TTL_MS before a fresh call is made.

/** How long a cached `analyzeHabitPoints` result stays valid. */
export const ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedAnalysis<T> {
  generatedAt: string;
  suggestions: T[];
}

const analysisCacheKey = (householdId: string): string => `lb_point_rebalance_analysis_${householdId}`;

/** Read a still-fresh cached analysis for the household, or `null` if absent/stale/malformed. */
export function readAnalysisCache<T>(householdId: string, now: Date = new Date()): T[] | null {
  try {
    const raw = window.localStorage.getItem(analysisCacheKey(householdId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAnalysis<T>;
    if (!parsed || typeof parsed.generatedAt !== 'string' || !Array.isArray(parsed.suggestions)) return null;
    const ageMs = now.getTime() - new Date(parsed.generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > ANALYSIS_CACHE_TTL_MS) return null;
    return parsed.suggestions;
  } catch {
    return null;
  }
}

/** Cache an `analyzeHabitPoints` result for the household. */
export function writeAnalysisCache<T>(householdId: string, suggestions: T[], now: Date = new Date()): void {
  try {
    const payload: CachedAnalysis<T> = { generatedAt: now.toISOString(), suggestions };
    window.localStorage.setItem(analysisCacheKey(householdId), JSON.stringify(payload));
  } catch {
    // Best-effort — worst case we just re-run the analysis next mount.
  }
}
