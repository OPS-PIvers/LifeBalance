/**
 * Client-generated ID helper shared by anything that needs a stable local key
 * before a Firestore write assigns one (custom habits, habit location
 * triggers, etc.) — `crypto.randomUUID` with a fallback for non-secure
 * contexts (older Safari / non-HTTPS dev) where it's unavailable.
 */
export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
