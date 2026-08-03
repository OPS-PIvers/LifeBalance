/**
 * Unit tests for notificationMutations.ts's `healMemberTimezone` (TZ-1).
 *
 * The two things only this module can be held to:
 *  - the write is a DOT-PATH update (`'notificationPreferences.timezone'`),
 *    never a whole-map write that could clobber sibling preference sections;
 *  - a rejected write is caught and logged, never rethrown — this callback
 *    backs a login-time auto-heal that must not be able to block app boot.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const updateDocMock = vi.fn();

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((_db: unknown, path: string, id: string) => ({ __path: `${path}/${id}` })),
    updateDoc: (...args: unknown[]) => updateDocMock(...args),
  };
});

import { makeHealMemberTimezone } from './notificationMutations';

const db = {} as never;
const householdId = 'household-1';

describe('makeHealMemberTimezone', () => {
  beforeEach(() => {
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the timezone via a dot-path, not a whole-map write', async () => {
    const { healMemberTimezone } = makeHealMemberTimezone({ db, householdId });

    await healMemberTimezone('member-1', 'America/Chicago');

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [ref, patch] = updateDocMock.mock.calls[0] as [{ __path: string }, Record<string, unknown>];
    expect(ref.__path).toBe(`households/${householdId}/members/member-1`);
    // Exactly the dot-path key — never a top-level `notificationPreferences`
    // key, which would be a whole-map write and clobber sibling sections.
    expect(patch).toEqual({ 'notificationPreferences.timezone': 'America/Chicago' });
    expect(Object.keys(patch)).not.toContain('notificationPreferences');
  });

  it('no-ops without a householdId', async () => {
    const { healMemberTimezone } = makeHealMemberTimezone({ db, householdId: null });

    await healMemberTimezone('member-1', 'America/Chicago');

    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected write instead of throwing', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('offline'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { healMemberTimezone } = makeHealMemberTimezone({ db, householdId });

    await expect(healMemberTimezone('member-1', 'America/Chicago')).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
