import { describe, it, expect } from 'vitest';
import {
  AA_NORMAL_TEXT_CONTRAST,
  AVATAR_TEXT_DARK,
  AVATAR_TEXT_LIGHT,
  avatarTextColor,
  contrastRatio,
} from '@/utils/contrastColor';

describe('contrastRatio', () => {
  it('is 21:1 for pure black vs pure white (the WCAG maximum)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is 1:1 for a color against itself', () => {
    expect(contrastRatio('#b87a29', '#b87a29')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#285742', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#285742'), 10);
  });

  it('matches the measured ratio for the amber pole (warm-500) against white', () => {
    // DESIGN.md documents this exact figure: "warm-500 is 3.6:1 on white —
    // fine for icons/fills, below AA for text."
    expect(contrastRatio('#b87a29', '#ffffff')).toBeCloseTo(3.59, 1);
  });
});

describe('avatarTextColor', () => {
  it('picks white for the evergreen pole, which clears AA against white', () => {
    expect(contrastRatio('#285742', AVATAR_TEXT_LIGHT)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
    expect(avatarTextColor('#285742')).toBe(AVATAR_TEXT_LIGHT);
  });

  it('picks the dark fallback for the amber pole, which does NOT clear AA against white', () => {
    expect(contrastRatio('#b87a29', AVATAR_TEXT_LIGHT)).toBeLessThan(AA_NORMAL_TEXT_CONTRAST);
    expect(avatarTextColor('#b87a29')).toBe(AVATAR_TEXT_DARK);
  });

  it('the dark fallback itself clears AA against the amber pole it was picked for', () => {
    expect(contrastRatio(AVATAR_TEXT_DARK, '#b87a29')).toBeGreaterThanOrEqual(AA_NORMAL_TEXT_CONTRAST);
  });

  it('falls back to white for a non-hex background (a CSS custom property)', () => {
    // HouseholdAvatar / the TopToolbar profile fallback pass
    // `var(--color-brand-600)` — not inspectable as a resolved color, and
    // deliberately dark enough for white text in both themes.
    expect(avatarTextColor('var(--color-brand-600)')).toBe(AVATAR_TEXT_LIGHT);
  });

  it('rejects a 3-digit hex shorthand (member colors are always 6-digit) — falls back to white', () => {
    expect(avatarTextColor('#fff')).toBe(AVATAR_TEXT_LIGHT);
  });
});
