/* eslint-disable */

/**
 * Maximum allowed string length for Firestore fields to prevent DoS via large payloads.
 * 10,000 characters is approximately 10KB-40KB depending on encoding, well below the 1MB document limit,
 * but large enough for practically any user text field (notes, descriptions).
 */
export const MAX_FIRESTORE_STRING_LENGTH = 10000;

/**
 * Recursively sanitizes an object for Firestore by removing undefined values,
 * trimming strings, and enforcing length limits to prevent abuse.
 * Firestore does not accept undefined values in documents.
 *
 * @param obj The object to sanitize
 * @returns A new object with undefined values removed, strings trimmed and truncated
 */
export const sanitizeFirestoreData = (obj: any): any => {
  if (obj === undefined) {
    return null;
  }

  if (obj === null) {
    return null;
  }

  if (typeof obj === 'string') {
    const trimmed = obj.trim();
    if (trimmed.length > MAX_FIRESTORE_STRING_LENGTH) {
      console.warn(
        'String truncated from length',
        trimmed.length,
        'to',
        MAX_FIRESTORE_STRING_LENGTH
      );
      return trimmed.slice(0, MAX_FIRESTORE_STRING_LENGTH);
    }
    return trimmed === "" ? null : trimmed;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeFirestoreData(item)).filter(item => item !== undefined);
  }

  if (typeof obj === 'object') {
    // Handle Dates and Firestore Timestamps (pass them through)
    if (obj instanceof Date || (obj.seconds !== undefined && obj.nanoseconds !== undefined)) {
      return obj;
    }

    const newObj: any = {};
    Object.keys(obj).forEach(key => {
      const value = sanitizeFirestoreData(obj[key]);
      if (value !== undefined) {
        newObj[key] = value;
      }
    });
    return newObj;
  }

  return obj;
};
