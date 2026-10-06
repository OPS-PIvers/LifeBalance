import type { WallVoiceMiss, WallVoiceMissKind } from '@/types/schema';

/**
 * The wall's voice miss log (docs/DECISIONS.md "Voice misses"): what a
 * command that went wrong sounded like, as text, for the nightly
 * voice-learning routine to teach the grammar from.
 */

/** At most this many misses a day per wall, so a chatty TV can't flood the log. */
export const MISS_DAILY_CAP = 100;
/** Misses expire (Firestore TTL on `expireAt`) after this long, read or not. */
export const MISS_TTL_DAYS = 30;
/** "Undo" this soon after a command counts as that command being wrong. */
export const MISS_UNDO_WINDOW_MS = 10_000;
/** Longest text kept per field (firestore.rules enforces the same bound). */
export const MISS_TEXT_MAX = 300;

const STORAGE_KEY = 'LB_WALL_VOICE_MISSES';

export type VoiceMissDraft = Omit<WallVoiceMiss, 'expireAt' | 'displayId'>;

export interface VoiceMissInput {
  kind: WallVoiceMissKind;
  heard: string;
  free?: string;
  alternative?: string;
  engine: WallVoiceMiss['engine'];
  view: string;
  did?: string;
  appVersion: string;
  now: Date;
}

const clip = (s: string | undefined) => (s ?? '').trim().slice(0, MISS_TEXT_MAX);

export function buildVoiceMiss({ kind, heard, free, alternative, engine, view, did, appVersion, now }: VoiceMissInput): VoiceMissDraft {
  return {
    kind,
    heard: clip(heard),
    free: clip(free),
    alternative: clip(alternative),
    engine,
    view: clip(view),
    ...(did ? { did: clip(did) } : {}),
    appVersion: clip(appVersion),
    at: now.toISOString(),
  };
}

export function missExpiry(at: string): number {
  return Date.parse(at) + MISS_TTL_DAYS * 24 * 60 * 60 * 1000;
}

type MissStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Counts a miss against today's cap; false = the cap is spent, don't log.
 * Storage that's missing or throws never blocks logging (the server-side
 * TTL still bounds what's kept).
 */
export function takeMissSlot(storage: MissStorage | null, date: string, cap = MISS_DAILY_CAP): boolean {
  if (!storage) return true;
  try {
    const [day, raw] = (storage.getItem(STORAGE_KEY) ?? '').split('|');
    const used = day === date ? Number(raw) || 0 : 0;
    if (used >= cap) return false;
    storage.setItem(STORAGE_KEY, `${date}|${used + 1}`);
    return true;
  } catch {
    return true;
  }
}
