/**
 * Maximum allowed string length for Firestore fields to prevent DoS via large payloads.
 * 10,000 characters is approximately 10KB-40KB depending on encoding, well below the 1MB document limit,
 * but large enough for practically any user text field (notes, descriptions).
 */
export const MAX_FIRESTORE_STRING_LENGTH = 10000;

/**
 * Internal recursive implementation; returns `unknown` to handle all value
 * types (null, string, array, object, primitives) without a type lie.
 */
const sanitizeValue = (obj: unknown): unknown => {
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
    return obj.map(item => sanitizeValue(item)).filter(item => item !== undefined);
  }

  if (typeof obj === 'object') {
    // Handle Dates
    if (obj instanceof Date) {
      return obj;
    }

    // Handle Firestore Timestamps (duck typing)
    if ('seconds' in obj && 'nanoseconds' in obj) {
      return obj;
    }

    // Handle Firestore sentinel values (deleteField, increment, arrayUnion, etc.)
    // These have a _methodName property and must be preserved as-is
    const record = obj as Record<string, unknown>;
    if ('_methodName' in record) {
      return obj;
    }

    const newObj: Record<string, unknown> = {};

    Object.keys(record).forEach(key => {
      const value = sanitizeValue(record[key]);
      if (value !== undefined) {
        newObj[key] = value;
      }
    });
    return newObj;
  }

  return obj;
};

/**
 * Recursively sanitizes an object for Firestore by removing undefined values,
 * trimming strings, and enforcing length limits to prevent abuse.
 * Firestore does not accept undefined values in documents.
 *
 * Callers always pass plain objects; the return type is narrowed to
 * `Record<string, unknown>` so the result can be spread into Firestore writes.
 *
 * @param obj The object to sanitize
 * @returns A new object with undefined values removed, strings trimmed and truncated
 */
export const sanitizeFirestoreData = (obj: unknown): Record<string, unknown> =>
  sanitizeValue(obj) as Record<string, unknown>;
