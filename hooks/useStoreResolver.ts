import { useCallback } from 'react';
import { useShopping } from '@/contexts/FirebaseHouseholdContext';
import { findExistingStore, normalizeStoreName } from '@/utils/storeMatch';

/**
 * Resolves AI-returned store names against the household's existing stores,
 * creating a new store ONLY when it is certainly not a duplicate of one that
 * already exists (matched via {@link normalizeStoreName}). Returns canonical
 * store names so a transaction/shopping item always references a real store.
 */
export function useStoreResolver() {
  const { stores, addStore } = useShopping();

  /**
   * Resolve a batch of names to canonical store names. Existing stores resolve
   * to their canonical name/casing; genuinely-new ones are created exactly once
   * (sequentially, to avoid duplicate `arrayUnion` writes when several items in
   * one batch share the same new store). Returns a map keyed by the normalized
   * store key.
   */
  const ensureStores = useCallback(
    async (names: (string | undefined | null)[]): Promise<Map<string, string>> => {
      const resolved = new Map<string, string>();
      const toCreate = new Map<string, string>(); // key -> display name

      for (const raw of names) {
        const name = raw?.trim();
        if (!name) continue;
        const key = normalizeStoreName(name);
        if (!key || resolved.has(key) || toCreate.has(key)) continue;
        const existing = findExistingStore(name, stores);
        if (existing) {
          resolved.set(key, existing.name);
        } else {
          toCreate.set(key, name);
        }
      }

      for (const [key, name] of toCreate) {
        await addStore({ name });
        resolved.set(key, name);
      }
      return resolved;
    },
    [stores, addStore],
  );

  /** Resolve one store name to its canonical/created name (undefined if blank). */
  const ensureStore = useCallback(
    async (name: string | undefined | null): Promise<string | undefined> => {
      const map = await ensureStores([name]);
      const key = normalizeStoreName(name ?? '');
      return key ? map.get(key) : undefined;
    },
    [ensureStores],
  );

  return { ensureStores, ensureStore };
}
