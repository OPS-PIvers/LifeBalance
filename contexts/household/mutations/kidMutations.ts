import {
  doc,
  updateDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { Household, HouseholdMember } from '@/types/schema';
import { getFunctionsInstance } from '@/firebase.config';
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
  householdId: string | null;
  user: User | null;
  householdSettings: Household | null;
  membersRef: { current: HouseholdMember[] };
}) {
  const { householdId, user, householdSettings, membersRef } = deps;

  const addKidProfile = async (
    input: { displayName: string; avatarColor?: string; avatarEmoji?: string }
  ): Promise<void> => {
    if (!householdId) return;
    const parentUid = user?.uid;
    if (!parentUid) return;

    // Plan 080e — managed-kid-profile cap. Per Plan 080 Principle 6 we gate the
    // COUNT, never the mechanics: the cap is enforced ONLY while billing is live.
    // This client check is a fast UX guard that avoids a round-trip when the cap is
    // already reached; the AUTHORITATIVE boundary is the `createkidprofile` Cloud
    // Function (Plan 051), which re-counts server-side where a client can't lie.
    // While `billingEnabled` is off (current prod state) both are inert (ZERO change).
    if (await getBillingEnabled()) {
      const managedKidCount = membersRef.current.filter((m) => m.isManaged === true).length;
      if (householdSettings && kidProfileLimitReached(householdSettings, managedKidCount)) {
        toast.error('Kid profile limit reached. Upgrade to add more.');
        throw new Error('Kid profile limit reached');
      }
    }

    try {
      // The function creates the members-subcollection doc via the Admin SDK (no
      // memberUids update — a kid holds no credential) after enforcing the cap.
      const functions = await getFunctionsInstance();
      const createKidProfile = httpsCallable(functions, 'createkidprofile');
      await createKidProfile({
        householdId,
        displayName: input.displayName,
        ...(input.avatarColor ? { avatarColor: input.avatarColor } : {}),
        ...(input.avatarEmoji ? { avatarEmoji: input.avatarEmoji } : {}),
      });
      toast.success('Kid profile added');
    } catch (error) {
      // The function throws `resource-exhausted` when the cap is hit (billing live);
      // surface the same upsell copy as the client pre-check for that case.
      const code = (error as { code?: string } | null)?.code;
      if (code === 'functions/resource-exhausted') {
        toast.error('Kid profile limit reached. Upgrade to add more.');
      } else {
        console.error('[addKidProfile] Failed:', error);
        toast.error(describeError(error, 'add the kid profile'));
      }
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
      toast.error(describeError(error, 'update the kid profile'));
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
      toast.error(describeError(error, 'remove the kid profile'));
      throw error;
    }
  };

  return { updateKidProfile, removeKidProfile };
}
