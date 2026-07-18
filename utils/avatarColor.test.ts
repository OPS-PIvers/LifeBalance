import { describe, it, expect } from 'vitest';
import { AVATAR_COLORS, pickAvatarColor, resolveAvatarColor } from './avatarColor';

// --- WCAG helpers (test-local; mirrors the WCAG 2.x relative-luminance math) ---
const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrastVsWhite = (hex: string): number =>
  (1.0 + 0.05) / (relativeLuminance(hex) + 0.05);

describe('AVATAR_COLORS palette', () => {
  it('has 8 unique lowercase hex entries', () => {
    expect(AVATAR_COLORS).toHaveLength(8);
    expect(new Set(AVATAR_COLORS).size).toBe(8);
    for (const color of AVATAR_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('every palette color keeps white initials legible (WCAG >= 4.5:1)', () => {
    // Avatar chips render fixed white initials/emoji on the palette color in
    // BOTH themes, so the chip background itself is the contrast surface.
    for (const color of AVATAR_COLORS) {
      expect(contrastVsWhite(color), `${color} vs white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('contains no purple/violet hue (no-purple identity rule)', () => {
    // A violet reads as r ≈ b both well above g (e.g. legacy #7c3aed).
    for (const color of AVATAR_COLORS) {
      const [r, g, b] = hexToRgb(color);
      const isVividViolet = r > g + 40 && b > g + 40;
      expect(isVividViolet, `${color} looks violet`).toBe(false);
    }
  });
});

describe('pickAvatarColor', () => {
  it('is deterministic and always returns a palette color', () => {
    for (const seed of ['kid_leo', 'test-user-id', '', 'Ada Lovelace']) {
      const first = pickAvatarColor(seed);
      expect(AVATAR_COLORS).toContain(first);
      expect(pickAvatarColor(seed)).toBe(first);
    }
  });

  it('spreads different seeds across more than one palette color', () => {
    const picks = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(pickAvatarColor),
    );
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe('resolveAvatarColor (map-on-read, no migration)', () => {
  it('returns palette colors unchanged (case-insensitively)', () => {
    expect(resolveAvatarColor('#285742', 'seed')).toBe('#285742');
    expect(resolveAvatarColor('#285742'.toUpperCase(), 'seed')).toBe('#285742');
  });

  it('maps a legacy violet hex to the nearest palette color, deterministically', () => {
    const resolved = resolveAvatarColor('#7c3aed', 'kid_leo');
    expect(AVATAR_COLORS).toContain(resolved);
    // Violet's nearest neighbour in the palette is the muted indigo.
    expect(resolved).toBe('#535695');
    // Seed does not influence a stored-hex mapping.
    expect(resolveAvatarColor('#7c3aed', 'other-seed')).toBe(resolved);
  });

  it('maps shorthand #rgb hex values', () => {
    const resolved = resolveAvatarColor('#0f0', 'seed');
    expect(AVATAR_COLORS).toContain(resolved);
    expect(resolveAvatarColor('#00ff00', 'seed')).toBe(resolved);
  });

  it('hashes legacy non-hex strings into the palette, stably', () => {
    const resolved = resolveAvatarColor('amber', 'seed');
    expect(AVATAR_COLORS).toContain(resolved);
    expect(resolveAvatarColor('amber', 'different-seed')).toBe(resolved);
  });

  it('falls back to a stable seed-hashed palette color when unset', () => {
    const forUid = resolveAvatarColor(undefined, 'kid_leo');
    expect(AVATAR_COLORS).toContain(forUid);
    expect(resolveAvatarColor(null, 'kid_leo')).toBe(forUid);
    expect(resolveAvatarColor('', 'kid_leo')).toBe(forUid);
  });
});
