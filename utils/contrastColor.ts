/**
 * Generic WCAG 2.1 contrast math, plus the per-color avatar-initial foreground
 * picker it exists to support.
 *
 * `MemberAvatar`'s fallback circle renders a bold initial directly on top of
 * the member's identity fill (`utils/memberColors.ts`) at sizes as small as
 * 16px — well under the WCAG "large text" threshold, so it needs the AA
 * *normal*-text ratio of 4.5:1, not 3:1. Every color in the app's avatar
 * palettes (`MEMBER_COLOR_SEQUENCE`, `AVATAR_COLORS`) clears that against
 * WHITE except the amber pole (`warm-500`, `#b87a29`), which measures 3.59:1.
 *
 * The fix is a foreground swap, not a fill change. The fill is shared
 * identity — the SAME hex also colors the recap deck's stacked-bar chart
 * segments and legend, where WCAG 1.4.11 (non-text contrast) needs only
 * 3:1, and where darkening amber toward `money-neg`'s brownish-red would
 * measurably worsen their already-close deuteranopia distance (a prior
 * review flagged ~34/441; a warm-600 fill drops that to ~13/441 — worse).
 * Picking a dark foreground for just the text-on-fill case leaves the fill
 * — and therefore the chart — untouched, while `avatarTextColor` stays
 * correct automatically if a future palette edit shifts a color across the
 * threshold either direction. Pin: `utils/memberColors.test.ts`.
 */

const HEX6_RE = /^#[0-9a-f]{6}$/i;

/** Parse a `#rrggbb` string into [r, g, b] (0–255). Assumes HEX6_RE matched. */
const hexToRgb = (hex: string): [number, number, number] => {
  const raw = hex.slice(1);
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
};

const srgbChannelToLinear = (channel255: number): number => {
  const c = channel255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance (0–1) of a `#rrggbb` color. */
const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
  );
};

/**
 * WCAG 2.1 contrast ratio between two `#rrggbb` colors, order-independent.
 * Ranges 1 (identical luminance) to 21 (black vs white).
 */
export const contrastRatio = (hexA: string, hexB: string): number => {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
};

/** WCAG AA contrast floor for normal-size text (< 18.66px bold / 24px regular). */
export const AA_NORMAL_TEXT_CONTRAST = 4.5;

/** White — the default (and majority) avatar-initial color. */
export const AVATAR_TEXT_LIGHT = '#ffffff';

/**
 * Dark near-black avatar-initial color for fills that don't clear AA against
 * white. Mirrors `index.css`'s `--color-brand-900` (the app's darkest
 * neutral, already the standard dark-on-light body-text color) rather than
 * pure black, so a dark-foreground avatar still reads as "this app's ink",
 * not an arbitrary contrasting color.
 */
export const AVATAR_TEXT_DARK = '#161512';

/**
 * The initial's color for a given fill: white when it clears WCAG AA
 * normal-text contrast (4.5:1) against white, else the dark fallback above.
 *
 * Falls back to white for a background that isn't a literal `#rrggbb` hex —
 * `HouseholdAvatar` and the `TopToolbar` profile fallback pass a CSS custom
 * property (`var(--color-brand-600)`) instead of a member's resolved hex,
 * specifically because that step is dark enough for white text in BOTH
 * themes (see `HouseholdAvatar`'s doc comment) and isn't inspectable from
 * JS as a resolved color.
 */
export const avatarTextColor = (backgroundColor: string): string => {
  if (!HEX6_RE.test(backgroundColor)) return AVATAR_TEXT_LIGHT;
  return contrastRatio(backgroundColor, AVATAR_TEXT_LIGHT) >= AA_NORMAL_TEXT_CONTRAST
    ? AVATAR_TEXT_LIGHT
    : AVATAR_TEXT_DARK;
};
