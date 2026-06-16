import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth } from '@/firebase.config';
import { generateInviteCode } from '@/utils/inviteCodeGenerator';
import {
  getUserHousehold,
  createHousehold,
  joinHousehold,
  getHouseholdDetails,
} from '@/services/householdService';

vi.mock('@/firebase.config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('@/utils/inviteCodeGenerator', () => ({ generateInviteCode: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  doc: vi.fn((...a: unknown[]) => ({ path: a.join('/') })),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  arrayUnion: vi.fn((v: unknown) => ({ __arrayUnion: v })),
  serverTimestamp: vi.fn(() => 'TS'),
}));

// Helper to mutate the mocked auth.currentUser.
const mockAuth = auth as unknown as { currentUser: unknown };

describe('householdService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.currentUser = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUserHousehold', () => {
    it('returns null when no household contains the user', async () => {
      vi.mocked(getDocs).mockResolvedValue({
        empty: true,
        docs: [],
      } as unknown as Awaited<ReturnType<typeof getDocs>>);

      await expect(getUserHousehold('user-1')).resolves.toBeNull();
    });

    it('returns the first matching household id', async () => {
      vi.mocked(getDocs).mockResolvedValue({
        empty: false,
        docs: [{ id: 'h1' }],
      } as unknown as Awaited<ReturnType<typeof getDocs>>);

      await expect(getUserHousehold('user-1')).resolves.toBe('h1');
    });

    it('rethrows when getDocs rejects', async () => {
      vi.mocked(getDocs).mockRejectedValue(new Error('network'));

      await expect(getUserHousehold('user-1')).rejects.toThrow('network');
    });
  });

  describe('createHousehold', () => {
    it('throws when there is no authenticated user', async () => {
      vi.mocked(generateInviteCode).mockResolvedValue('ABC123');
      mockAuth.currentUser = null;

      await expect(createHousehold('user-1', 'Home')).rejects.toThrow('No authenticated user');
    });

    it('creates the household, invite-code index, and admin member', async () => {
      vi.mocked(generateInviteCode).mockResolvedValue('ABC123');
      mockAuth.currentUser = {
        displayName: 'Alice',
        email: 'alice@example.com',
        photoURL: 'http://img/alice.png',
      };
      vi.mocked(addDoc).mockResolvedValue({
        id: 'newHh',
      } as unknown as Awaited<ReturnType<typeof addDoc>>);
      vi.mocked(setDoc).mockResolvedValue(undefined);

      const result = await createHousehold('user-1', 'Home');

      expect(result).toBe('newHh');

      // Household document payload.
      expect(addDoc).toHaveBeenCalledTimes(1);
      const householdPayload = vi.mocked(addDoc).mock.calls[0]![1] as Record<string, unknown>;
      expect(householdPayload).toMatchObject({
        name: 'Home',
        inviteCode: 'ABC123',
        createdBy: 'user-1',
        memberUids: ['user-1'],
        points: { daily: 0, weekly: 0, total: 0 },
        freezeBank: { current: 0, accrued: 0, lastMonth: '' },
      });

      // setDoc called twice: invite-code index + member doc.
      expect(setDoc).toHaveBeenCalledTimes(2);
      const memberPayload = vi.mocked(setDoc).mock.calls[1]![1] as Record<string, unknown>;
      expect(memberPayload).toMatchObject({
        uid: 'user-1',
        role: 'admin',
        displayName: 'Alice',
        email: 'alice@example.com',
      });
    });
  });

  describe('joinHousehold', () => {
    it('throws when there is no authenticated user', async () => {
      mockAuth.currentUser = null;

      await expect(joinHousehold('user-1', 'abc123')).rejects.toThrow('No authenticated user');
    });

    it('throws "Invalid invite code" when the invite does not exist', async () => {
      mockAuth.currentUser = { displayName: 'Bob', email: 'bob@example.com', photoURL: '' };
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => false,
      } as unknown as Awaited<ReturnType<typeof getDoc>>);

      await expect(joinHousehold('user-1', 'abc123')).rejects.toThrow('Invalid invite code');
    });

    it('throws when the user is already a member', async () => {
      mockAuth.currentUser = { displayName: 'Bob', email: 'bob@example.com', photoURL: '' };
      vi.mocked(getDoc)
        // invite lookup
        .mockResolvedValueOnce({
          exists: () => true,
          data: () => ({ householdId: 'h9' }),
        } as unknown as Awaited<ReturnType<typeof getDoc>>)
        // existing-member check
        .mockResolvedValueOnce({
          exists: () => true,
        } as unknown as Awaited<ReturnType<typeof getDoc>>);

      await expect(joinHousehold('user-1', 'abc123')).rejects.toThrow(
        'You are already a member of this household'
      );
    });

    it('adds the member (role: member) before updating memberUids and returns the household id', async () => {
      mockAuth.currentUser = { displayName: 'Bob', email: 'bob@example.com', photoURL: '' };
      vi.mocked(getDoc)
        .mockResolvedValueOnce({
          exists: () => true,
          data: () => ({ householdId: 'h9' }),
        } as unknown as Awaited<ReturnType<typeof getDoc>>)
        .mockResolvedValueOnce({
          exists: () => false,
        } as unknown as Awaited<ReturnType<typeof getDoc>>);

      const callOrder: string[] = [];
      vi.mocked(setDoc).mockImplementation(async () => {
        callOrder.push('setDoc');
      });
      vi.mocked(updateDoc).mockImplementation(async () => {
        callOrder.push('updateDoc');
      });

      const result = await joinHousehold('user-1', 'abc123');

      expect(result).toBe('h9');
      // Membership-first ordering.
      expect(callOrder).toEqual(['setDoc', 'updateDoc']);

      const memberPayload = vi.mocked(setDoc).mock.calls[0]![1] as Record<string, unknown>;
      expect(memberPayload).toMatchObject({
        uid: 'user-1',
        role: 'member',
        inviteCode: 'ABC123', // uppercased
      });
    });
  });

  describe('getHouseholdDetails', () => {
    it('returns null when the household does not exist', async () => {
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => false,
      } as unknown as Awaited<ReturnType<typeof getDoc>>);

      await expect(getHouseholdDetails('h1')).resolves.toBeNull();
    });

    it('returns name and inviteCode when the household exists', async () => {
      vi.mocked(getDoc).mockResolvedValue({
        exists: () => true,
        data: () => ({ name: 'Home', inviteCode: 'ABC123' }),
      } as unknown as Awaited<ReturnType<typeof getDoc>>);

      await expect(getHouseholdDetails('h1')).resolves.toEqual({
        name: 'Home',
        inviteCode: 'ABC123',
      });
    });

    it('rethrows when getDoc rejects', async () => {
      vi.mocked(getDoc).mockRejectedValue(new Error('boom'));

      await expect(getHouseholdDetails('h1')).rejects.toThrow('boom');
    });
  });
});
