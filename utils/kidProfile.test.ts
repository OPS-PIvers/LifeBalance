import { describe, it, expect } from 'vitest';
import { newKidMemberId, buildKidMemberDoc } from '@/utils/kidProfile';

const ALLOWED_KEYS = new Set([
  'uid',
  'displayName',
  'role',
  'isManaged',
  'managedByUid',
  'avatarColor',
  'avatarEmoji',
  'points',
  'allowanceCents',
]);

describe('newKidMemberId', () => {
  it('returns a string starting with "kid_"', () => {
    const id = newKidMemberId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('kid_')).toBe(true);
  });

  it('returns unique values on successive calls', () => {
    const a = newKidMemberId();
    const b = newKidMemberId();
    expect(a).not.toBe(b);
  });
});

describe('buildKidMemberDoc', () => {
  it('sets role, isManaged, managedByUid, uid, and trimmed displayName', () => {
    const result = buildKidMemberDoc({ displayName: '  Leo  ' }, 'parent-uid', 'kid_x');
    expect(result.role).toBe('kid');
    expect(result.isManaged).toBe(true);
    expect(result.managedByUid).toBe('parent-uid');
    expect(result.uid).toBe('kid_x');
    expect(result.displayName).toBe('Leo');
  });

  it('initialises points to all-zero', () => {
    const result = buildKidMemberDoc({ displayName: 'Leo' }, 'parent-uid', 'kid_x');
    expect(result.points).toEqual({ daily: 0, weekly: 0, total: 0 });
  });

  it('initialises allowanceCents to 0', () => {
    const result = buildKidMemberDoc({ displayName: 'Leo' }, 'parent-uid', 'kid_x');
    expect(result.allowanceCents).toBe(0);
  });

  it('falls back to "Kid" when displayName is empty', () => {
    const result = buildKidMemberDoc({ displayName: '' }, 'parent-uid', 'kid_x');
    expect(result.displayName).toBe('Kid');
  });

  it('falls back to "Kid" when displayName is only whitespace', () => {
    const result = buildKidMemberDoc({ displayName: '   ' }, 'parent-uid', 'kid_x');
    expect(result.displayName).toBe('Kid');
  });

  it('omits avatarColor when not provided', () => {
    const result = buildKidMemberDoc({ displayName: 'Leo' }, 'parent-uid', 'kid_x');
    expect('avatarColor' in result).toBe(false);
  });

  it('omits avatarEmoji when not provided', () => {
    const result = buildKidMemberDoc({ displayName: 'Leo' }, 'parent-uid', 'kid_x');
    expect('avatarEmoji' in result).toBe(false);
  });

  it('includes avatarColor when provided', () => {
    const result = buildKidMemberDoc(
      { displayName: 'Leo', avatarColor: 'brand-purple' },
      'parent-uid',
      'kid_x',
    );
    expect(result.avatarColor).toBe('brand-purple');
  });

  it('includes avatarEmoji when provided', () => {
    const result = buildKidMemberDoc(
      { displayName: 'Leo', avatarEmoji: '🦁' },
      'parent-uid',
      'kid_x',
    );
    expect(result.avatarEmoji).toBe('🦁');
  });

  it('has no keys outside the allowed set', () => {
    const result = buildKidMemberDoc(
      { displayName: 'Leo', avatarColor: 'brand-blue', avatarEmoji: '🐻' },
      'parent-uid',
      'kid_x',
    );
    const keys = Object.keys(result);
    const unexpected = keys.filter(k => !ALLOWED_KEYS.has(k));
    expect(unexpected).toEqual([]);
  });
});
