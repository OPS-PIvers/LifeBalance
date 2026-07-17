import { describe, it, expect } from 'vitest';
import {
  BUCKET_COLORS,
  BUCKET_COLOR_KEYS,
  DEFAULT_BUCKET_COLOR,
  normalizeBucketColorKey,
  bucketColorClass,
} from './bucketColors';

describe('bucketColors', () => {
  it('every key maps to itself with a bg class and label', () => {
    for (const key of BUCKET_COLOR_KEYS) {
      expect(BUCKET_COLORS[key].id).toBe(key);
      // r6 retune: each key renders a muted OKLCH arbitrary-value class.
      expect(BUCKET_COLORS[key].bg).toMatch(/^bg-\[oklch\([0-9._ ]+\)\]$/);
      expect(BUCKET_COLORS[key].label.length).toBeGreaterThan(0);
    }
  });

  describe('normalizeBucketColorKey', () => {
    it('passes through valid keys unchanged', () => {
      for (const key of BUCKET_COLOR_KEYS) {
        expect(normalizeBucketColorKey(key)).toBe(key);
      }
    });

    it('maps every legacy raw class to its key (color preserved)', () => {
      // The eight legacy options.
      const legacy: Record<string, string> = {
        'bg-emerald-500': 'emerald',
        'bg-blue-500': 'blue',
        'bg-purple-500': 'purple',
        'bg-orange-500': 'orange',
        'bg-pink-500': 'pink',
        'bg-red-500': 'red',
        'bg-indigo-500': 'indigo',
        'bg-cyan-500': 'cyan',
      };
      for (const [raw, key] of Object.entries(legacy)) {
        expect(normalizeBucketColorKey(raw)).toBe(key);
      }
    });

    it('maps a legacy class at a non-500 shade to its key', () => {
      expect(normalizeBucketColorKey('bg-blue-400')).toBe('blue');
    });

    it('falls back to the default for missing/unknown/garbage values', () => {
      expect(normalizeBucketColorKey(undefined)).toBe(DEFAULT_BUCKET_COLOR);
      expect(normalizeBucketColorKey(null)).toBe(DEFAULT_BUCKET_COLOR);
      expect(normalizeBucketColorKey('')).toBe(DEFAULT_BUCKET_COLOR);
      expect(normalizeBucketColorKey('bg-chartreuse-500')).toBe(DEFAULT_BUCKET_COLOR); // not a known hue
      expect(normalizeBucketColorKey('not-a-color')).toBe(DEFAULT_BUCKET_COLOR);
    });
  });

  describe('bucketColorClass', () => {
    it('resolves a key to its bg class', () => {
      expect(bucketColorClass('blue')).toBe(BUCKET_COLORS.blue.bg);
    });
    it('passes through any already-valid bg-* class unchanged', () => {
      // The legacy picker classes...
      expect(bucketColorClass('bg-emerald-500')).toBe('bg-emerald-500');
      // ...and non-picker tokens used by synthetic buckets (e.g. Unbudgeted) /
      // arbitrary fixtures — so they render exactly as before, not defaulted.
      expect(bucketColorClass('bg-brand-400')).toBe('bg-brand-400');
      expect(bucketColorClass('bg-green-500')).toBe('bg-green-500');
    });
    it('resolves the default for missing/garbage input', () => {
      expect(bucketColorClass(undefined)).toBe(BUCKET_COLORS[DEFAULT_BUCKET_COLOR].bg);
      expect(bucketColorClass('not-a-class')).toBe(BUCKET_COLORS[DEFAULT_BUCKET_COLOR].bg);
    });
  });
});
