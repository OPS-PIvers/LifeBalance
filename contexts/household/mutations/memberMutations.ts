import {
  doc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { HouseholdMember } from '@/types/schema';
import { getFunctionsInstance } from '@/firebase.config';

// Pure-ish factories for the member-management mutation family, moved
// verbatim out of FirebaseHouseholdContext. See
// advisor-plans/08-context-decomposition.md step 4. Kid-profile CRUD lives in
// the sibling kidMutations.ts.
//
// Factories are split by the exact set of REACTIVE values each function's
// original closure captured, so every provider `useCallback` constructs a
// deps object containing only what its original closure actually used — its
// dependency array stays byte-identical AND eslint's exhaustive-deps
// analysis sees no phantom dependencies.

/**
 * addMember — original closure captured only `householdId`.
 */
export function makeAddMember(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const addMember = async (memberData: Partial<HouseholdMember>) => {
    if (!householdId) return;

    try {
      // If UID is not provided (e.g. manual add), generate one
      // Note: These users cannot log in unless linked to a real auth account later
      const newMemberUid = memberData.uid || crypto.randomUUID();

      const member: HouseholdMember = {
        uid: newMemberUid,
        displayName: memberData.displayName || 'New Member',
        email: memberData.email || '',
        role: memberData.role || 'member',
        // Spread memberData first, then override points to ensure new members start at 0
        ...memberData,
        points: { daily: 0, weekly: 0, total: 0 },
      };

      // Write the member doc and the household memberUids array in a SINGLE
      // batch so they can't desync (a member doc without a matching memberUids
      // entry would break household access rules).
      const batch = writeBatch(db);
      batch.set(doc(db, `households/${householdId}/members`, newMemberUid), {
        ...member,
        joinedAt: serverTimestamp(),
      });
      batch.update(doc(db, `households/${householdId}`), {
        memberUids: arrayUnion(newMemberUid),
      });
      await batch.commit();

      toast.success('Member added successfully');
    } catch (error) {
      console.error('[addMember] Failed:', error);
      toast.error(describeError(error, 'add the member'));
      throw error;
    }
  };

  return { addMember };
}

/**
 * updateMember / removeMember — original closures captured only `householdId`.
 */
export function makeMemberCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const updateMember = async (memberId: string, updates: Partial<HouseholdMember>) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, `households/${householdId}/members`, memberId), updates);
      toast.success('Member updated successfully');
    } catch (error) {
      console.error('[updateMember] Failed:', error);
      toast.error(describeError(error, 'update the member'));
      throw error;
    }
  };

  const removeMember = async (memberId: string) => {
    if (!householdId) return;

    try {
      // Use batch to make both operations atomic
      const batch = writeBatch(db);

      // 1. Remove from household memberUids array
      const householdRef = doc(db, `households/${householdId}`);
      batch.update(householdRef, {
        memberUids: arrayRemove(memberId),
      });

      // 2. Delete member document from subcollection
      const memberRef = doc(db, `households/${householdId}/members`, memberId);
      batch.delete(memberRef);

      // Commit both changes atomically
      await batch.commit();

      toast.success('Member removed successfully');
    } catch (error) {
      console.error('[removeMember] Failed:', error);
      toast.error(describeError(error, 'remove the member'));
      throw error;
    }
  };

  return { updateMember, removeMember };
}

/**
 * deleteHousehold — original closure captured only `householdId`.
 */
export function makeDeleteHousehold(deps: {
  householdId: string | null;
}) {
  const { householdId } = deps;

  const deleteHousehold = async () => {
    if (!householdId) return;
    const [{ httpsCallable }, functions] = await Promise.all([
      import('firebase/functions'),
      getFunctionsInstance(),
    ]);
    const fn = httpsCallable(functions, 'deletehousehold');
    await fn({ householdId });
    toast.success('Household deleted');
    // Hard reload so AuthContext re-resolves (no household -> routes to /setup) and
    // all Firestore listeners tear down cleanly.
    window.location.reload();
  };

  return { deleteHousehold };
}
