import {
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { Household, HouseholdMember } from '@/types/schema';
import { newKidMemberId, buildKidMemberDoc } from '@/utils/kidProfile';
import { getBillingEnabled } from '@/services/appConfig';
import { kidProfileLimitReached } from '@/utils/entitlements';
import type { User } from 'firebase/auth';

// Pure-ish factories for the Kid Profile CRUD mutation family (Plan 080a-2),
// moved verbatim out of FirebaseHouseholdContext. See
// advisor-plans/08-context-decomposition.md step 4.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * addKidProfile — original closure captured `householdId`, `user`,
 * `householdSettings`, and read `membersRef` (ref, not reactive) inside.
 */
export function makeAddKidProfile(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
  householdSettings: Household | null;
  membersRef: { current: HouseholdMember[] };
}) {
  const { db, householdId, user, householdSettings, membersRef } = deps;

  const addKidProfile = async (
    input: { displayName: string; avatarColor?: string; avatarEmoji?: string }
  ): Promise<void> => {
    if (!householdId) return;
    const parentUid = user?.uid;
    if (!parentUid) return;

    // Plan 080e — managed-kid-profile cap. Per Plan 080 Principle 6 we gate the
    // COUNT, never the mechanics: the cap is enforced ONLY while billing is live.
    // While `billingEnabled` is off (current prod state) this whole block is
    // skipped, so behavior is identical to before (ZERO change). getBillingEnabled
    // is cheap/cached (60s TTL) and fails closed to `false`, keeping the gate
    // dormant if config is unreachable. The cap is client-side PRODUCT logic for
    // UX — never a security boundary (member creates for kids stay rules-allowed).
    if (await getBillingEnabled()) {
      const managedKidCount = membersRef.current.filter((m) => m.isManaged === true).length;
      if (householdSettings && kidProfileLimitReached(householdSettings, managedKidCount)) {
        toast.error('Kid profile limit reached. Upgrade to add more.');
        throw new Error('Kid profile limit reached');
      }
    }

    try {
      const uid = newKidMemberId();
      // Single doc write to the members subcollection ONLY — no memberUids update
      // (no credential). A kid's synthetic uid can never be used to authenticate.
      await setDoc(doc(db, `households/${householdId}/members`, uid), {
        ...buildKidMemberDoc(input, parentUid, uid),
        joinedAt: serverTimestamp(),
      });
      toast.success('Kid profile added');
    } catch (error) {
      console.error('[addKidProfile] Failed:', error);
      toast.error('Failed to add kid profile');
      throw error;
    }
  };

  return { addKidProfile };
}

/**
 * updateKidProfile / removeKidProfile — original closures captured only
 * `householdId`. removeKidProfile also called `setActiveMemberId` (state
 * setter, passed through so the callback signature matches the provider's).
 */
export function makeKidProfileCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
  setActiveMemberId: (updater: (prev: string | null) => string | null) => void;
}) {
  const { db, householdId, setActiveMemberId } = deps;

  const updateKidProfile = async (
    memberId: string,
    updates: { displayName?: string; avatarColor?: string; avatarEmoji?: string }
  ): Promise<void> => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}/members`, memberId), updates);
    } catch (error) {
      console.error('[updateKidProfile] Failed:', error);
      toast.error('Failed to update kid profile');
      throw error;
    }
  };

  const removeKidProfile = async (memberId: string): Promise<void> => {
    if (!householdId) return;
    try {
      // Kid was never added to memberUids — just delete the member doc.
      await deleteDoc(doc(db, `households/${householdId}/members`, memberId));
      // Functional update so the callback needn't depend on activeMemberId.
      setActiveMemberId((prev) => (prev === memberId ? null : prev));
      toast.success('Kid profile removed');
    } catch (error) {
      console.error('[removeKidProfile] Failed:', error);
      toast.error('Failed to remove kid profile');
      throw error;
    }
  };

  return { updateKidProfile, removeKidProfile };
}
