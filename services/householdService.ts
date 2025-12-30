import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '@/firebase.config';
import { generateInviteCode } from '@/utils/inviteCodeGenerator';

/**
 * Get the household ID for a given user
 * @param userId - The user's UID
 * @returns Promise<string | null> - The household ID or null if not found
 */
export const getUserHousehold = async (userId: string): Promise<string | null> => {
  try {
    const householdsRef = collection(db, 'households');
    const q = query(householdsRef, where('memberUids', 'array-contains', userId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    return snapshot.docs[0].id;
  } catch (error) {
    console.error('Error getting user household:', error);
    throw error;
  }
};

/**
 * Create a new household
 * @param userId - The creator's user ID
 * @param householdName - The name of the household
 * @returns Promise<string> - The new household ID
 */
export const createHousehold = async (userId: string, householdName: string): Promise<string> => {
  try {
    const inviteCode = await generateInviteCode();
    const user = auth.currentUser;

    if (!user) {
      throw new Error('No authenticated user');
    }

    // Create household document
    const householdRef = await addDoc(collection(db, 'households'), {
      name: householdName,
      inviteCode,
      createdAt: serverTimestamp(),
      createdBy: userId,
      memberUids: [userId],
      freezeBank: {
        current: 0,
        accrued: 0,
        lastMonth: '',
      },
    });

    // Add invite code to index
    await setDoc(doc(db, 'inviteCodes', inviteCode), {
      code: inviteCode,
      householdId: householdRef.id,
      createdAt: serverTimestamp(),
    });

    // Add creator as admin member
    await setDoc(doc(db, 'households', householdRef.id, 'members', userId), {
      uid: userId,
      displayName: user.displayName || 'User',
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: 'admin',
      points: {
        daily: 0,
        weekly: 0,
        total: 0,
      },
      joinedAt: serverTimestamp(),
    });

    return householdRef.id;
  } catch (error) {
    console.error('Error creating household:', error);
    throw error;
  }
};

/**
 * Join an existing household using an invite code
 * @param userId - The user's ID
 * @param inviteCode - The 6-character invite code
 * @returns Promise<string> - The household ID
 */
export const joinHousehold = async (userId: string, inviteCode: string): Promise<string> => {
  try {
    const user = auth.currentUser;

    if (!user) {
      throw new Error('No authenticated user');
    }

    // Lookup household by invite code
    const inviteDoc = await getDoc(doc(db, 'inviteCodes', inviteCode.toUpperCase()));

    if (!inviteDoc.exists()) {
      throw new Error('Invalid invite code');
    }

    const householdId = inviteDoc.data().householdId;

    // Check if user is already a member
    const existingMember = await getDoc(doc(db, 'households', householdId, 'members', userId));
    if (existingMember.exists()) {
      throw new Error('You are already a member of this household');
    }

    // Add user to household memberUids array
    await updateDoc(doc(db, 'households', householdId), {
      memberUids: arrayUnion(userId),
    });

    // Add member document
    await setDoc(doc(db, 'households', householdId, 'members', userId), {
      uid: userId,
      displayName: user.displayName || 'User',
      email: user.email || '',
      photoURL: user.photoURL || '',
      role: 'member',
      points: {
        daily: 0,
        weekly: 0,
        total: 0,
      },
      joinedAt: serverTimestamp(),
    });

    return householdId;
  } catch (error: any) {
    console.error('Error joining household:', error);
    throw error;
  }
};

/**
 * Get household details including invite code
 * @param householdId - The household ID
 * @returns Promise<{ name: string; inviteCode: string } | null>
 */
export const getHouseholdDetails = async (
  householdId: string
): Promise<{ name: string; inviteCode: string } | null> => {
  try {
    const householdDoc = await getDoc(doc(db, 'households', householdId));

    if (!householdDoc.exists()) {
      return null;
    }

    const data = householdDoc.data();
    return {
      name: data.name,
      inviteCode: data.inviteCode,
    };
  } catch (error) {
    console.error('Error getting household details:', error);
    throw error;
  }
};
