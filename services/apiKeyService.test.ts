import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import type { ApiKeyPermissions } from '@/types/schema';
import {
  generateApiKey,
  regenerateApiKey,
  revokeApiKey,
  updateApiKeyPermissions,
  updateApiKeyName,
  deleteApiKey,
  getQuickAddBaseUrl,
  getQuickAddEndpointUrl,
} from '@/services/apiKeyService';

vi.mock('@/firebase.config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ __collection: true })),
  addDoc: vi.fn(async () => ({ id: 'docId' })),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn((...a: unknown[]) =>
    // doc(collection) → new ref with a generated id; doc(db, path) → ref at path
    a.length === 1 ? { id: 'newDocId' } : { path: a.join('/') }
  ),
  serverTimestamp: vi.fn(() => 'TS'),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => undefined),
  })),
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

  describe('regenerateApiKey', () => {
    it('mints a fresh key in the lb_{prefix}_{32hex} format with a matching hash', async () => {
      const result = await regenerateApiKey(
        'household-abc',
        'old-key-id',
        'iPhone Shortcut',
        permissions,
        'creator-1'
      );

      expect(result.key).toMatch(/^lb_.{6}_[a-f0-9]{32}$/);
      expect(result.key.startsWith('lb_househ_')).toBe(true);
      expect(result.keyData.hashedKey).toBe(await sha256Hex(result.key));
    });

    it('carries over the name and permissions and resets usage metadata', async () => {
      const result = await regenerateApiKey(
        'household-abc',
        'old-key-id',
        '  iPhone Shortcut  ',
        permissions,
        'creator-1'
      );

      expect(result.keyData.name).toBe('iPhone Shortcut');
      expect(result.keyData.permissions).toEqual(permissions);
      expect(result.keyData.usageCount).toBe(0);
      expect(result.keyData.status).toBe('active');
      expect(result.keyData.lastUsedAt).toBeUndefined();
      expect(result.keyData.createdBy).toBe('creator-1');
      // Fresh doc id from doc(collection) — not the old key's id.
      expect((result.keyData as { id?: string }).id).toBe('newDocId');
    });

    it('atomically creates the new key and deletes the old one in a single batch', async () => {
      await regenerateApiKey('household-abc', 'old-key-id', 'Key', permissions, 'creator-1');

      // One batch, committed exactly once.
      expect(writeBatch).toHaveBeenCalledTimes(1);
      const batch = vi.mocked(writeBatch).mock.results[0]!.value as {
        set: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        commit: ReturnType<typeof vi.fn>;
      };
      expect(batch.set).toHaveBeenCalledTimes(1);
      expect(batch.delete).toHaveBeenCalledTimes(1);
      expect(batch.commit).toHaveBeenCalledTimes(1);

      // The deleted ref is the OLD key's document path.
      const deletedRef = batch.delete.mock.calls[0]![0];
      expect(deletedRef).toEqual({
        path: expect.stringContaining('households/household-abc/apiKeys/old-key-id'),
      });

      // Never routes through addDoc/updateDoc — that would bypass the atomic
      // swap and (for updates) hit the rules ban on mutating hashedKey.
      expect(addDoc).not.toHaveBeenCalled();
      expect(updateDoc).not.toHaveBeenCalled();
    });

    it('produces a different secret than the key it replaces', async () => {
      const a = await regenerateApiKey('household-abc', 'k', 'Key', permissions, 'creator-1');
      const b = await regenerateApiKey('household-abc', 'k', 'Key', permissions, 'creator-1');

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
      // Explicitly unset regardless of any VITE_FIREBASE_PROJECT_ID picked up
      // from a local .env.local, so this assertion doesn't depend on the
      // developer's environment.
      vi.stubEnv('VITE_FIREBASE_PROJECT_ID', undefined);
      expect(getQuickAddBaseUrl()).toBe(
        'https://us-central1-lifebalance-26080.cloudfunctions.net'
      );
      vi.unstubAllEnvs();
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
      expect(getQuickAddEndpointUrl('naturalLanguage')).toMatch(/\/quickAddNaturalLanguage$/);
    });
  });
});
