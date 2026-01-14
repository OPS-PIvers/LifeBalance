import { describe, it, expect } from 'vitest';
import { normalizeValue, normalizeToKey } from './stringNormalizer';

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

  describe('normalizeToKey', () => {
    it('trims and lowercases the input', () => {
      expect(normalizeToKey('  Hello World  ')).toBe('hello world');
    });

    it('returns empty string for null', () => {
      expect(normalizeToKey(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(normalizeToKey(undefined)).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(normalizeToKey('')).toBe('');
    });

    it('returns empty string for string with only whitespace', () => {
      expect(normalizeToKey(' ')).toBe('');
    });

    it('handles already lowercase strings', () => {
      expect(normalizeToKey('hello')).toBe('hello');
    });

    it('handles mixed case strings', () => {
      expect(normalizeToKey('HeLLo')).toBe('hello');
    });
  });
});
