// Categorical bucket identity colors.
//
// A bucket's chosen hue is persisted DATA. It used to be stored as a raw Tailwind
// class string ("bg-emerald-500") directly on the document, which meant the
// budget data carried presentation classes that could never be themed or
// dark-tuned and drifted from the token system. This module makes the persisted
// value a stable semantic KEY ("emerald") and defines the actual class in ONE
// place, mirroring data/storeColors.ts.
//
// These are a deliberate categorical *data palette* (like data-viz), intentionally
// exempt from the app's two-accent (evergreen/amber) chrome rule — eight visually
// distinct hues are needed to tell budget categories apart. Centralizing them here
// is the win (stable key as data + one place to dark-tune), not collapsing them
// onto the accent palette.

export type BucketColorKey =
  | 'emerald'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'red'
  | 'indigo'
  | 'cyan';

export interface BucketColor {
  id: BucketColorKey;
  label: string;
  /**
   * The bg utility for the bucket's dot + progress-bar fill. Add a dark variant
   * here (and a resolver for it) when these categorical colors get dark-tuned —
   * the whole point of centralizing them is that it happens in one place.
   */
  bg: string;
}

// Keys map 1:1 to the eight legacy `bg-<name>-500` options, so migrating an
// existing bucket preserves its exact color.
export const BUCKET_COLORS: Record<BucketColorKey, BucketColor> = {
  emerald: { id: 'emerald', label: 'Emerald', bg: 'bg-emerald-500' },
  blue: { id: 'blue', label: 'Blue', bg: 'bg-blue-500' },
  purple: { id: 'purple', label: 'Purple', bg: 'bg-purple-500' },
  orange: { id: 'orange', label: 'Orange', bg: 'bg-orange-500' },
  pink: { id: 'pink', label: 'Pink', bg: 'bg-pink-500' },
  red: { id: 'red', label: 'Red', bg: 'bg-red-500' },
  indigo: { id: 'indigo', label: 'Indigo', bg: 'bg-indigo-500' },
  cyan: { id: 'cyan', label: 'Cyan', bg: 'bg-cyan-500' },
};

export const BUCKET_COLOR_KEYS = Object.keys(BUCKET_COLORS) as BucketColorKey[];

export const DEFAULT_BUCKET_COLOR: BucketColorKey = 'emerald';

const isBucketColorKey = (v: string): v is BucketColorKey =>
  Object.prototype.hasOwnProperty.call(BUCKET_COLORS, v);

/**
 * Normalize a persisted bucket color to its key. Accepts:
 *  - the new key form ('emerald') — returned as-is,
 *  - the legacy raw Tailwind class ('bg-emerald-500') — mapped to its key,
 *  - anything missing/unrecognized — DEFAULT_BUCKET_COLOR.
 * Backward-compatible: a document that still stores the raw class keeps its exact
 * color, so no destructive backfill is required (new writes use the key; the
 * Firestore converter normalizes on read).
 */
export const normalizeBucketColorKey = (
  stored: string | undefined | null,
): BucketColorKey => {
  if (!stored) return DEFAULT_BUCKET_COLOR;
  if (isBucketColorKey(stored)) return stored;
  // Legacy 'bg-<name>-NNN' → '<name>' when that name is a known key.
  const match = /^bg-([a-z]+)-\d{2,3}$/.exec(stored);
  if (match && match[1] && isBucketColorKey(match[1])) return match[1];
  return DEFAULT_BUCKET_COLOR;
};

/**
 * The bg utility class for a bucket's dot / progress-bar fill, resolved from its
 * stored color. Use this at render sites instead of interpolating `bucket.color`
 * directly. Resolution order:
 *  - a key ('emerald') → its mapped class,
 *  - any already-valid `bg-*` class → passed through unchanged. This covers the
 *    legacy picker classes ('bg-emerald-500') AND non-picker tokens used by
 *    synthetic buckets (e.g. the Unbudgeted bucket's 'bg-brand-400'), so they
 *    render exactly as before,
 *  - anything else (missing / garbage) → the default color's class.
 */
export const bucketColorClass = (stored: string | undefined | null): string => {
  if (!stored) return BUCKET_COLORS[DEFAULT_BUCKET_COLOR].bg;
  if (isBucketColorKey(stored)) return BUCKET_COLORS[stored].bg;
  if (stored.startsWith('bg-')) return stored;
  return BUCKET_COLORS[DEFAULT_BUCKET_COLOR].bg;
};
