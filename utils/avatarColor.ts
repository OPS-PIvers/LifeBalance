// Member/kid avatar identity colors.
//
// `HouseholdMember.avatarColor` is persisted DATA (an arbitrary hex string on
// legacy docs), which historically let off-palette hues — including violet —
// onto always-visible surfaces (ProfileMenu kid rows, KidsChoresWidget,
// KidDashboard). The app's identity is explicitly no-purple (see DESIGN.md):
// evergreen `accent-*`, amber `warm-*`, plus the muted categorical hues of
// data/bucketColors.ts.
//
// This module constrains avatars to a token-derived palette with a pure
// MAP-ON-READ (`resolveAvatarColor`) — no Firestore migration, no write-backs.
// Legacy hex values are mapped to the nearest palette color deterministically;
// non-hex strings and missing values hash (stably) into the palette.

/**
 * The avatar palette. Hex values are hardcoded (they're used in inline
 * `style={{ backgroundColor }}`, same as the stored data they replace) but each
 * is derived from a token family:
 *  - evergreen  = `--color-accent-600` (index.css @theme, the primary accent)
 *  - amber      = `--color-warm-600`
 *  - the rest are sRGB conversions of the muted OKLCH categorical hues in
 *    data/bucketColors.ts (impeccable r6 retune), darkened to L 0.48–0.53 so
 *    white initials stay legible: sage oklch(0.50 0.09 155), slate blue
 *    oklch(0.50 0.09 250), terracotta oklch(0.53 0.12 55), dusty rose
 *    oklch(0.52 0.09 10), teal oklch(0.51 0.08 200), indigo oklch(0.48 0.10 280).
 *
 * Every entry keeps a WCAG contrast ratio ≥ 4.5:1 against the fixed white
 * initials/emoji foreground (asserted in avatarColor.test.ts) in both themes —
 * the chip's own background is the contrast surface, so theme doesn't matter.
 */
export const AVATAR_COLORS = [
  '#285742', // evergreen (accent-600) — 8.3:1 vs white
  '#97611f', // amber (warm-600) — 5.2:1
  '#33724c', // sage — 5.8:1
  '#386695', // slate blue — 6.0:1
  '#9f5618', // terracotta — 5.5:1
  '#95525d', // dusty rose — 5.8:1
  '#197478', // teal — 5.5:1
  '#535695', // indigo — 6.7:1
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const isPaletteColor = (value: string): value is AvatarColor =>
  (AVATAR_COLORS as readonly string[]).includes(value.toLowerCase());

/** Parse #rgb / #rrggbb into [r, g, b] (0–255). Assumes HEX_RE matched. */
const hexToRgb = (hexColor: string): [number, number, number] => {
  const raw = hexColor.slice(1);
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

/** Deterministic small string hash (djb2 xor variant), non-negative. */
const hashString = (value: string): number => {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

/** Stable palette pick for an arbitrary seed (uid, name, legacy token string). */
export const pickAvatarColor = (seed: string): AvatarColor => {
  // Non-null: AVATAR_COLORS is a non-empty tuple and the index is % length.
  return AVATAR_COLORS[hashString(seed) % AVATAR_COLORS.length]!;
};

/** Nearest palette color to a hex value by squared RGB distance (deterministic;
 * ties resolve to the earlier palette entry). */
const nearestPaletteColor = (hexColor: string): AvatarColor => {
  const [r, g, b] = hexToRgb(hexColor);
  let best: AvatarColor = AVATAR_COLORS[0];
  let bestDist = Infinity;
  for (const candidate of AVATAR_COLORS) {
    const [cr, cg, cb] = hexToRgb(candidate);
    const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
};

/**
 * Map-on-read: resolve a stored `avatarColor` (possibly legacy arbitrary hex,
 * possibly missing) to a palette color. Pure and deterministic — the same
 * inputs always render the same color, with NO data migration:
 *  - already a palette color → returned as-is,
 *  - legacy hex → nearest palette color by RGB distance,
 *  - any other non-empty string (legacy token names like 'amber') → hashed
 *    into the palette,
 *  - missing/empty → hashed from `seed` (pass a stable id, e.g. the member uid).
 */
export const resolveAvatarColor = (
  stored: string | undefined | null,
  seed: string,
): AvatarColor => {
  if (!stored) return pickAvatarColor(seed);
  if (isPaletteColor(stored)) return stored.toLowerCase() as AvatarColor;
  if (HEX_RE.test(stored)) return nearestPaletteColor(stored);
  return pickAvatarColor(stored);
};
