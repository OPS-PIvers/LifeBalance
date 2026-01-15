import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';

/**
 * Generate a unique 6-character invite code
 * @returns Promise<string> - The generated invite code
 */
export const generateInviteCode = async (): Promise<string> => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    code = '';
    // 🛡️ Sentinel Security Fix: Use crypto.getRandomValues() for secure random generation
    // Math.random() is not cryptographically secure and can be predictable.
    const randomValues = new Uint32Array(6);
    crypto.getRandomValues(randomValues);

    for (let i = 0; i < 6; i++) {
      code += chars.charAt(randomValues[i] % chars.length);
    }

    // Check if code already exists
    try {
      const inviteDoc = await getDoc(doc(db, 'inviteCodes', code));
      isUnique = !inviteDoc.exists();
    } catch (error) {
      console.error('Error checking invite code uniqueness:', error);
      // On error, assume code might exist and try again
      isUnique = false;
    }

    attempts++;
  }

  if (!isUnique) {
    throw new Error('Failed to generate unique invite code');
  }

  return code;
};
