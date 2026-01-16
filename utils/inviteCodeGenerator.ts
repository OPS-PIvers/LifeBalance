import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';

/**
 * Generate a unique 6-character invite code
 * Uses rejection sampling to ensure cryptographically secure, unbiased random selection.
 * @returns Promise<string> - The generated invite code
 */
export const generateInviteCode = async (): Promise<string> => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const charLength = chars.length;
  let code = '';
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  // Rejection sampling limit to avoid modulo bias
  // We want the largest multiple of charLength that fits in uint32
  // 2^32 = 4294967296
  // 4294967296 % 36 = 16
  // Limit = 4294967296 - 16 = 4294967280
  const limit = 4294967296 - (4294967296 % charLength);

  // Pre-allocate buffer for efficiency
  // We need 6 characters, but might need more for rejection sampling
  // Allocating slightly more (e.g., 12) reduces chance of needing a refill
  const bufferSize = 12;
  const randomBuffer = new Uint32Array(bufferSize);

  while (!isUnique && attempts < maxAttempts) {
    code = '';
    let validCharsFound = 0;

    // Fill the buffer
    crypto.getRandomValues(randomBuffer);

    let bufferIndex = 0;

    while (validCharsFound < 6) {
      // If we ran out of buffer, refill it
      if (bufferIndex >= bufferSize) {
        crypto.getRandomValues(randomBuffer);
        bufferIndex = 0;
      }

      const randomValue = randomBuffer[bufferIndex];
      bufferIndex++;

      // Rejection sampling: discard if value falls in the biased zone
      if (randomValue < limit) {
        code += chars.charAt(randomValue % charLength);
        validCharsFound++;
      }
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
