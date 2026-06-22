import { describe, it, expect } from 'vitest';
import { buildInviteUrl, parseInviteCode } from './inviteLink';

describe('inviteLink', () => {
  describe('buildInviteUrl', () => {
    it('builds a HashRouter-correct URL with the query after the hash', () => {
      // jsdom default origin is http://localhost:3000, pathname "/"
      expect(buildInviteUrl('ABC123')).toBe(
        'http://localhost:3000/#/setup?invite=ABC123'
      );
    });

    it('places the query after the hash, not before it', () => {
      const url = buildInviteUrl('ABC123');
      const hashIndex = url.indexOf('#');
      const queryIndex = url.indexOf('?');
      expect(hashIndex).toBeGreaterThan(-1);
      expect(queryIndex).toBeGreaterThan(hashIndex);
    });

    it('percent-encodes codes containing characters that are special in URLs', () => {
      expect(buildInviteUrl('A B&C')).toBe(
        'http://localhost:3000/#/setup?invite=A%20B%26C'
      );
    });

    it('round-trips an encoded code back through parseInviteCode', () => {
      const url = buildInviteUrl('XY7Z9Q');
      // Simulate what react-router exposes: the search portion after the hash.
      const search = url.slice(url.indexOf('?'));
      expect(parseInviteCode(search)).toBe('XY7Z9Q');
    });
  });

  describe('parseInviteCode', () => {
    it('extracts the code from a search string', () => {
      expect(parseInviteCode('?invite=ABC123')).toBe('ABC123');
    });

    it('works without a leading question mark', () => {
      expect(parseInviteCode('invite=ABC123')).toBe('ABC123');
    });

    it('uppercases the code to match stored casing', () => {
      expect(parseInviteCode('?invite=abc123')).toBe('ABC123');
    });

    it('trims surrounding whitespace', () => {
      // A literal space encodes as %20; URLSearchParams decodes it back.
      expect(parseInviteCode('?invite=%20abc123%20')).toBe('ABC123');
    });

    it('decodes percent-encoded values', () => {
      expect(parseInviteCode('?invite=A%20B%26C')).toBe('A B&C');
    });

    it('returns null when the invite param is missing', () => {
      expect(parseInviteCode('?other=foo')).toBeNull();
    });

    it('returns null for an empty search string', () => {
      expect(parseInviteCode('')).toBeNull();
    });

    it('returns null when the invite param is present but empty', () => {
      expect(parseInviteCode('?invite=')).toBeNull();
    });

    it('returns null when the invite param is only whitespace', () => {
      expect(parseInviteCode('?invite=%20%20')).toBeNull();
    });

    it('extracts the code when other params are present', () => {
      expect(parseInviteCode('?ref=email&invite=ABC123&utm=share')).toBe(
        'ABC123'
      );
    });

    it('uses the first invite param when duplicated', () => {
      expect(parseInviteCode('?invite=ABC123&invite=XYZ789')).toBe('ABC123');
    });
  });
});
