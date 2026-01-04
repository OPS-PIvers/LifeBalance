
/**
 * Recursively sanitizes an object for Firestore by removing undefined values.
 * Firestore does not accept undefined values in documents.
 *
 * @param obj The object to sanitize
 * @returns A new object with undefined values removed
 */
export const sanitizeFirestoreData = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
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
