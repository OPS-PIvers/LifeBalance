import type { HouseholdMember } from '@/types/schema';

/** A login-less kid id: an unguessable, non-auth id that can never equal a real Firebase Auth uid. */
export const newKidMemberId = (): string => `kid_${crypto.randomUUID()}`;

export interface NewKidProfileInput {
  displayName: string;
  avatarColor?: string;
  avatarEmoji?: string;
}

/**
 * Build the Firestore member doc for a managed kid profile (Plan 080). Pure — no I/O.
 * The caller adds `joinedAt: serverTimestamp()`. The field set here must stay within the
 * `isValidManagedKidCreate` rule's allow-list in firestore.rules (uid, displayName, role,
 * isManaged, managedByUid, avatarColor, avatarEmoji, points, allowanceCents, joinedAt).
 */
export const buildKidMemberDoc = (
  input: NewKidProfileInput,
  parentUid: string,
  uid: string,
): HouseholdMember => ({
  uid,
  displayName: input.displayName.trim() || 'Kid',
  role: 'kid',
  isManaged: true,
  managedByUid: parentUid,
  ...(input.avatarColor ? { avatarColor: input.avatarColor } : {}),
  ...(input.avatarEmoji ? { avatarEmoji: input.avatarEmoji } : {}),
  points: { daily: 0, weekly: 0, total: 0 },
  allowanceCents: 0,
});
