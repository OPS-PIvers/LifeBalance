import { describe, it, expect, afterEach, vi } from 'vitest';
import { describeError, isFirebaseErrorLike } from './errorMessages';

/** Build a FirebaseError-shaped object without importing the SDK. */
const fbError = (code: string, message = 'internal detail'): Error & { code: string } =>
  Object.assign(new Error(message), { code });

const setOnLine = (value: boolean) =>
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isFirebaseErrorLike', () => {
  it('accepts bare and prefixed Firebase codes', () => {
    expect(isFirebaseErrorLike(fbError('permission-denied'))).toBe(true);
    expect(isFirebaseErrorLike(fbError('functions/resource-exhausted'))).toBe(true);
    expect(isFirebaseErrorLike(fbError('auth/network-request-failed'))).toBe(true);
    expect(isFirebaseErrorLike({ code: 'unavailable' })).toBe(true);
  });

  it('rejects non-objects, missing codes, and non-code strings', () => {
    expect(isFirebaseErrorLike(null)).toBe(false);
    expect(isFirebaseErrorLike(undefined)).toBe(false);
    expect(isFirebaseErrorLike('permission-denied')).toBe(false);
    expect(isFirebaseErrorLike(new Error('boom'))).toBe(false);
    expect(isFirebaseErrorLike({ code: 500 })).toBe(false);
    expect(isFirebaseErrorLike({ code: 'HTTP 500 Server Error' })).toBe(false);
  });
});

describe('describeError', () => {
  it('detects browser-offline state even for plain errors', () => {
    setOnLine(false);
    const msg = describeError(new Error('anything'), 'save the transaction');
    expect(msg).toContain("You're offline");
    expect(msg).toContain('save the transaction');
    expect(msg).toContain('sync');
    expect(msg).not.toContain('anything');
  });

  it("read failures get plain retry copy offline — no false 'will sync' promise", () => {
    setOnLine(false);
    const msg = describeError(new Error('anything'), 'load older transactions', 'read');
    expect(msg).toContain("You're offline");
    expect(msg).toContain('try again');
    expect(msg).not.toContain('sync');
  });

  it('treats Firestore unavailable as offline/connectivity copy', () => {
    setOnLine(true);
    const msg = describeError(fbError('unavailable'), 'add the item');
    expect(msg).toContain("You're offline");
    expect(msg).toContain('add the item');
  });

  it('treats fetch/network error messages as connectivity failures', () => {
    setOnLine(true);
    expect(describeError(new TypeError('Failed to fetch'), 'send feedback')).toContain(
      "You're offline"
    );
  });

  it('gives permission-denied its own copy with a recovery hint', () => {
    setOnLine(true);
    const msg = describeError(fbError('permission-denied'), 'update the habit');
    expect(msg).toContain("don't have permission");
    expect(msg).toContain('update the habit');
    expect(msg).toContain('household');
  });

  it('gives unauthenticated sign-in copy (prefixed code too)', () => {
    setOnLine(true);
    const msg = describeError(fbError('functions/unauthenticated'), 'generate an insight');
    expect(msg).toContain('signed out');
    expect(msg).toContain('generate an insight');
  });

  it('gives resource-exhausted quota copy', () => {
    setOnLine(true);
    const msg = describeError(fbError('functions/resource-exhausted'), 'scan the receipt');
    expect(msg).toContain('limit reached');
    expect(msg).toContain('scan the receipt');
  });

  it('passes through the crafted Gemini daily-AI-quota message verbatim', () => {
    setOnLine(true);
    const quota = new Error('Daily AI quota exceeded (25 requests/day). Try again tomorrow.');
    expect(describeError(quota, 'generate an insight')).toBe(quota.message);
  });

  it('falls back for a plain Error without leaking its message', () => {
    setOnLine(true);
    const msg = describeError(new Error('FIRESTORE INTERNAL ASSERTION FAILED'), 'save the meal');
    expect(msg).toBe("Couldn't save the meal. Please try again.");
  });

  it('falls back for non-Error throws (string, undefined)', () => {
    setOnLine(true);
    expect(describeError('boom', 'delete the store')).toBe(
      "Couldn't delete the store. Please try again."
    );
    expect(describeError(undefined, 'delete the store')).toBe(
      "Couldn't delete the store. Please try again."
    );
  });

  it('keeps a short code suffix for other recognized Firebase codes', () => {
    setOnLine(true);
    const msg = describeError(fbError('failed-precondition', 'index missing blah'), 'load history');
    expect(msg).toBe("Couldn't load history. Please try again. (failed-precondition)");
    expect(msg).not.toContain('index missing');
  });
});
