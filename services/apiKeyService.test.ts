import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import type { ApiKeyPermissions } from '@/types/schema';
import {
  generateApiKey,
  revokeApiKey,
  updateApiKeyPermissions,
  updateApiKeyName,
  deleteApiKey,
  getQuickAddBaseUrl,
  getQuickAddEndpointUrl,
} from '@/services/apiKeyService';

vi.mock('@/firebase.config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'docId' })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn((...a: unknown[]) => ({ path: a.join('/') })),
  serverTimestamp: vi.fn(() => 'TS'),
}));

const permissions: ApiKeyPermissions = {
  habits: true,
  expenses: false,
  shoppingList: true,
  receiptScanning: false,
};

// Independent SHA-256 hex implementation using the same WebCrypto the service
// uses; this is the load-bearing security assertion.
async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('apiKeyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateApiKey', () => {
    it('produces a key in the lb_{prefix}_{32hex} format using the household prefix', async () => {
      const result = await generateApiKey('household-abc', 'iPhone Shortcut', permissions, 'creator-1');

      expect(result.key).toMatch(/^lb_.{6}_[a-f0-9]{32}$/);
      // householdId.substring(0, 6)
      expect(result.key.startsWith('lb_househ_')).toBe(true);
    });

    it('stores a SHA-256 hash of the plain key (64 hex chars matching an independent hash)', async () => {
      const result = await generateApiKey('household-abc', 'Key', permissions, 'creator-1');

      expect(result.keyData.hashedKey).toMatch(/^[a-f0-9]{64}$/);
      expect(result.keyData.hashedKey).toBe(await sha256Hex(result.key));
    });

    it('sets keyPrefix to the first 16 chars of the key', async () => {
      const result = await generateApiKey('household-abc', 'Key', permissions, 'creator-1');

      expect(result.keyData.keyPrefix).toBe(result.key.substring(0, 16));
    });

    it('trims the name and sets default metadata fields', async () => {
      const result = await generateApiKey('household-abc', '  Padded Name  ', permissions, 'creator-1');

      expect(result.keyData.name).toBe('Padded Name');
      expect(result.keyData.usageCount).toBe(0);
      expect(result.keyData.status).toBe('active');
      expect(result.keyData.createdBy).toBe('creator-1');
      expect(result.keyData.permissions).toEqual(permissions);
      // createdAt is an ISO string.
      expect(typeof result.keyData.createdAt).toBe('string');
      expect(new Date(result.keyData.createdAt).toISOString()).toBe(result.keyData.createdAt);
    });

    it('persists once via addDoc and returns the new doc id', async () => {
      const result = await generateApiKey('household-abc', 'Key', permissions, 'creator-1');

      expect(addDoc).toHaveBeenCalledTimes(1);
      // The runtime object carries an `id` even though the static type is
      // Omit<HouseholdApiKey, 'id'>.
      expect((result.keyData as { id?: string }).id).toBe('docId');
    });

    it('produces different keys across calls (randomness)', async () => {
      const a = await generateApiKey('household-abc', 'Key', permissions, 'creator-1');
      const b = await generateApiKey('household-abc', 'Key', permissions, 'creator-1');

      expect(a.key).not.toBe(b.key);
      expect(a.keyData.hashedKey).not.toBe(b.keyData.hashedKey);
    });
  });

  describe('revokeApiKey', () => {
    it('updates the key doc status to revoked', async () => {
      await revokeApiKey('hh', 'key-1');

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const [ref, payload] = vi.mocked(updateDoc).mock.calls[0]!;
      expect(payload).toEqual({ status: 'revoked' });
      expect(ref).toEqual({ path: expect.stringContaining('households/hh/apiKeys/key-1') });
    });
  });

  describe('updateApiKeyPermissions', () => {
    it('updates the key doc with the new permissions', async () => {
      await updateApiKeyPermissions('hh', 'key-1', permissions);

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(updateDoc).mock.calls[0]![1];
      expect(payload).toEqual({ permissions });
    });
  });

  describe('updateApiKeyName', () => {
    it('updates the key doc with the trimmed name', async () => {
      await updateApiKeyName('hh', 'key-1', '  Renamed  ');

      expect(updateDoc).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(updateDoc).mock.calls[0]![1];
      expect(payload).toEqual({ name: 'Renamed' });
    });
  });

  describe('deleteApiKey', () => {
    it('deletes the key doc', async () => {
      await deleteApiKey('hh', 'key-1');

      expect(deleteDoc).toHaveBeenCalledTimes(1);
    });
  });

  describe('getQuickAddBaseUrl', () => {
    it('uses the default project id when the env var is unset', () => {
      expect(getQuickAddBaseUrl()).toBe(
        'https://us-central1-lifebalance-26080.cloudfunctions.net'
      );
    });

    it('uses VITE_FIREBASE_PROJECT_ID when set', () => {
      vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'myproj');
      expect(getQuickAddBaseUrl()).toBe('https://us-central1-myproj.cloudfunctions.net');
      vi.unstubAllEnvs();
    });
  });

  describe('getQuickAddEndpointUrl', () => {
    it('maps each endpoint to its function name', () => {
      expect(getQuickAddEndpointUrl('habit')).toMatch(/\/quickAddHabit$/);
      expect(getQuickAddEndpointUrl('expense')).toMatch(/\/quickAddExpense$/);
      expect(getQuickAddEndpointUrl('shopping')).toMatch(/\/quickAddShoppingItem$/);
      expect(getQuickAddEndpointUrl('receipt')).toMatch(/\/quickAddReceipt$/);
      expect(getQuickAddEndpointUrl('naturalLanguage')).toMatch(/\/quickAddNaturalLanguage$/);
    });
  });
});
