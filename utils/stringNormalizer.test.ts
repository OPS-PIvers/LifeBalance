import { describe, it, expect } from 'vitest';
import { normalizeValue } from './stringNormalizer';

describe('stringNormalizer', () => {
  describe('normalizeValue', () => {
    it('returns the string trimmed if it has whitespace', () => {
      expect(normalizeValue('  hello  ')).toBe('hello');
    });

    it('returns the string as is if it is already clean', () => {
      expect(normalizeValue('hello')).toBe('hello');
    });

    it('returns empty string for null', () => {
      expect(normalizeValue(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(normalizeValue(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(normalizeValue('')).toBe('');
    });

    it('returns empty string for string with only whitespace', () => {
      expect(normalizeValue('   ')).toBe('');
    });
  });
});
