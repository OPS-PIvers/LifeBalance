/**
 * Cause-specific, user-facing error copy for mutation failure toasts.
 *
 * `describeError(err, action)` turns an unknown thrown value into a short,
 * honest sentence that tells the user WHY the action failed and what to do
 * next — offline vs. permission vs. quota — instead of a generic
 * "Failed to save". It never dumps raw `error.message` internals at the user
 * (the one exception is the Gemini daily-AI-quota error, whose message is
 * already crafted user-facing copy in services/geminiService.ts and must not
 * be regressed to something vaguer).
 *
 * Firebase detection is STRUCTURAL on purpose: we only look for a
 * `code: string` property shaped like a Firebase error code
 * (`permission-denied`, `functions/resource-exhausted`, `auth/network-request-failed`).
 * Importing `FirebaseError` from the SDK here would drag firebase onto the
 * boot path for every component that shows an error toast.
 */

/** Structural stand-in for FirebaseError — see module doc for why. */
interface FirebaseErrorLike {
  code: string;
}

/** Firebase codes look like `permission-denied` or `functions/unavailable`. */
const FIREBASE_CODE_PATTERN = /^(?:[a-z]+\/)?[a-z][a-z-]*$/;

export function isFirebaseErrorLike(err: unknown): err is FirebaseErrorLike {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && FIREBASE_CODE_PATTERN.test(code);
}

/** `functions/resource-exhausted` → `resource-exhausted`; bare codes pass through. */
function normalizeCode(code: string): string {
  const slash = code.lastIndexOf('/');
  return slash >= 0 ? code.slice(slash + 1) : code;
}

/** Codes we have specific copy for; anything else recognized gets a short suffix. */
const NETWORK_CODES = new Set(['unavailable', 'network-request-failed', 'deadline-exceeded']);

function isNetworkishError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') // Safari's fetch failure message
  );
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Describe a thrown error as user-facing toast copy.
 *
 * @param err    The caught value (unknown — may not be an Error at all).
 * @param action Imperative lowercase phrase, e.g. "save the transaction",
 *               "add the item". Slots into "Couldn't <action>." and
 *               "You don't have permission to <action>."
 * @param kind   'write' (default) failures get the honest offline-persistence
 *               note (Firestore queues writes and syncs them on reconnect);
 *               'read' failures (loading history, AI calls) just fail offline —
 *               nothing queues — so they get plain retry copy instead.
 */
export function describeError(
  err: unknown,
  action: string,
  kind: 'write' | 'read' = 'write'
): string {
  // Gemini daily-AI-quota errors already carry crafted user-facing copy
  // ("Daily AI quota exceeded (N requests/day). Try again tomorrow.") —
  // pass it through rather than regressing it to something vaguer.
  if (err instanceof Error && /daily ai quota exceeded/i.test(err.message)) {
    return err.message;
  }

  const code = isFirebaseErrorLike(err) ? normalizeCode(err.code) : null;

  if ((code !== null && NETWORK_CODES.has(code)) || isOffline() || isNetworkishError(err)) {
    return kind === 'write'
      ? `You're offline — couldn't ${action} right now. Saved changes will sync automatically when you reconnect.`
      : `You're offline — couldn't ${action} right now. Check your connection and try again.`;
  }

  switch (code) {
    case 'permission-denied':
      return `You don't have permission to ${action}. Try signing in again, or check that you're still a member of this household.`;
    case 'unauthenticated':
      return `You're signed out — sign in again to ${action}.`;
    case 'resource-exhausted':
      return `Daily limit reached — couldn't ${action}. Try again tomorrow.`;
    default:
      break;
  }

  // Recognized Firebase code without dedicated copy: keep a short cause
  // suffix for supportability, but never the raw error message.
  if (code !== null) {
    return `Couldn't ${action}. Please try again. (${code})`;
  }

  return `Couldn't ${action}. Please try again.`;
}
