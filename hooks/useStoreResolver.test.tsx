import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStoreResolver } from './useStoreResolver';
import * as HouseholdContext from '@/contexts/FirebaseHouseholdContext';
import type { Store } from '@/types/schema';

/**
 * Covers the dedup-within-batch + create-store-exactly-once logic of
 * useStoreResolver (the underlying storeMatch helpers are tested separately).
 * useShopping() is mocked so we can assert exactly how many addStore() writes the
 * hook issues for a given batch of AI-returned names.
 */

const mockAddStore = vi.fn<(s: { name: string }) => Promise<void>>();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useShopping: vi.fn(),
}));

function setStores(stores: Pick<Store, 'id' | 'name'>[]) {
  (HouseholdContext.useShopping as Mock).mockReturnValue({
    stores,
    addStore: mockAddStore,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAddStore.mockResolvedValue(undefined);
  setStores([]);
});

describe('useStoreResolver — ensureStores (batch)', () => {
  it('creates a brand-new store exactly ONCE when two items name the same new store', async () => {
    setStores([]);
    const { result } = renderHook(() => useStoreResolver());

    let resolved: Map<string, string> | undefined;
    await act(async () => {
      // Two different surface spellings that normalize to the same key.
      resolved = await result.current.ensureStores(["Trader Joe's", 'trader joes']);
    });

    // Created exactly once, despite two inputs sharing the new store.
    expect(mockAddStore).toHaveBeenCalledTimes(1);
    expect(mockAddStore).toHaveBeenCalledWith({ name: "Trader Joe's" });
    // Both inputs resolve to the same canonical (first-seen) display name.
    expect(resolved?.get('trader joes')).toBe("Trader Joe's");
  });

  it('resolves an EXISTING store to its canonical name/casing instead of creating', async () => {
    setStores([{ id: 's1', name: 'Safeway' }]);
    const { result } = renderHook(() => useStoreResolver());

    let resolved: Map<string, string> | undefined;
    await act(async () => {
      // Different casing/whitespace of an existing store.
      resolved = await result.current.ensureStores(['  SAFEWAY ']);
    });

    expect(mockAddStore).not.toHaveBeenCalled();
    // Canonical casing from the existing store, not the AI's input casing.
    expect(resolved?.get('safeway')).toBe('Safeway');
  });

  it('skips blank, whitespace-only, null and undefined names (no writes, not in map)', async () => {
    setStores([]);
    const { result } = renderHook(() => useStoreResolver());

    let resolved: Map<string, string> | undefined;
    await act(async () => {
      resolved = await result.current.ensureStores(['', '   ', null, undefined]);
    });

    expect(mockAddStore).not.toHaveBeenCalled();
    expect(resolved?.size).toBe(0);
  });

  it('handles a mixed batch: one existing + one new, creating only the new one', async () => {
    setStores([{ id: 's1', name: 'Costco' }]);
    const { result } = renderHook(() => useStoreResolver());

    let resolved: Map<string, string> | undefined;
    await act(async () => {
      resolved = await result.current.ensureStores(['costco', 'Whole Foods']);
    });

    // Only the genuinely-new store is created.
    expect(mockAddStore).toHaveBeenCalledTimes(1);
    expect(mockAddStore).toHaveBeenCalledWith({ name: 'Whole Foods' });
    expect(resolved?.get('costco')).toBe('Costco'); // canonical existing
    expect(resolved?.get('whole foods')).toBe('Whole Foods'); // newly created
  });

  it('creates two distinct new stores when names normalize to different keys', async () => {
    setStores([]);
    const { result } = renderHook(() => useStoreResolver());

    await act(async () => {
      await result.current.ensureStores(['Aldi', 'Kroger']);
    });

    expect(mockAddStore).toHaveBeenCalledTimes(2);
    expect(mockAddStore).toHaveBeenCalledWith({ name: 'Aldi' });
    expect(mockAddStore).toHaveBeenCalledWith({ name: 'Kroger' });
  });
});

describe('useStoreResolver — ensureStore (single)', () => {
  it('returns the canonical name for an existing store', async () => {
    setStores([{ id: 's1', name: 'Target' }]);
    const { result } = renderHook(() => useStoreResolver());

    let name: string | undefined;
    await act(async () => {
      name = await result.current.ensureStore('target');
    });

    expect(name).toBe('Target');
    expect(mockAddStore).not.toHaveBeenCalled();
  });

  it('creates and returns the name for a new store', async () => {
    setStores([]);
    const { result } = renderHook(() => useStoreResolver());

    let name: string | undefined;
    await act(async () => {
      name = await result.current.ensureStore('Sprouts');
    });

    expect(name).toBe('Sprouts');
    expect(mockAddStore).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for a blank/nullish name and writes nothing', async () => {
    setStores([]);
    const { result } = renderHook(() => useStoreResolver());

    let blank: string | undefined;
    let nullish: string | undefined;
    await act(async () => {
      blank = await result.current.ensureStore('   ');
      nullish = await result.current.ensureStore(null);
    });

    expect(blank).toBeUndefined();
    expect(nullish).toBeUndefined();
    expect(mockAddStore).not.toHaveBeenCalled();
  });
});
