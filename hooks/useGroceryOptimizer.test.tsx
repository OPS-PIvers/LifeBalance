import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useGroceryOptimizer } from '@/hooks/useGroceryOptimizer';
import type { OptimizableItem } from '@/services/geminiService.types';

const optimizeGroceryListMock = vi.fn();
vi.mock('@/services/geminiService', () => ({
  optimizeGroceryList: optimizeGroceryListMock,
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

interface Item {
  id: string;
  name: string;
  category: string;
}

const mapToOptimizable = (i: Item): OptimizableItem => ({
  id: i.id,
  name: i.name,
  category: i.category,
});

const mapFromOptimizable = (orig: Item, opt: OptimizableItem): Item => ({
  ...orig,
  category: opt.category ?? orig.category,
});

const renderOptimizer = (config: {
  householdId?: string | null;
  items?: Item[];
  updateItem?: (item: Item) => Promise<void>;
  emptyMessage?: string;
  errorMessage?: string;
}) => {
  const updateItem = config.updateItem ?? vi.fn(() => Promise.resolve());
  const { result } = renderHook(() =>
    useGroceryOptimizer<Item>({
      householdId: config.householdId === undefined ? 'house-1' : config.householdId,
      items: config.items ?? [],
      updateItem,
      mapToOptimizable,
      mapFromOptimizable,
      emptyMessage: config.emptyMessage,
      errorMessage: config.errorMessage,
    })
  );
  return { result, updateItem };
};

describe('useGroceryOptimizer', () => {
  beforeEach(() => {
    optimizeGroceryListMock.mockReset();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('errors when householdId is null and never calls the AI', async () => {
    const { result, updateItem } = renderOptimizer({
      householdId: null,
      items: [{ id: '1', name: 'Milk', category: 'Dairy' }],
    });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('Household ID missing');
    expect(optimizeGroceryListMock).not.toHaveBeenCalled();
    expect(updateItem).not.toHaveBeenCalled();
    expect(result.current.isOptimizing).toBe(false);
  });

  it('errors with the empty message when the list is empty and never calls the AI', async () => {
    const { result } = renderOptimizer({ items: [] });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('List is empty');
    expect(optimizeGroceryListMock).not.toHaveBeenCalled();
  });

  it('uses a custom empty message when provided', async () => {
    const { result } = renderOptimizer({ items: [], emptyMessage: 'Nothing here' });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('Nothing here');
  });

  it('updates changed items and shows the optimized-count success toast', async () => {
    const items: Item[] = [
      { id: '1', name: 'Milk', category: 'Dairy' },
      { id: '2', name: 'Apple', category: 'Produce' },
    ];
    optimizeGroceryListMock.mockResolvedValue([
      { id: '1', name: 'Milk', category: 'Refrigerated' }, // changed
      { id: '2', name: 'Apple', category: 'Fruit' }, // changed
    ]);

    const { result, updateItem } = renderOptimizer({ items });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Optimized 2 items!', { icon: '✨' });
    expect(result.current.isOptimizing).toBe(false);
  });

  it('does not update when nothing changed and shows "Everything looks good!"', async () => {
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Dairy' }];
    optimizeGroceryListMock.mockResolvedValue([
      { id: '1', name: 'Milk', category: 'Dairy' }, // identical
    ]);

    const { result, updateItem } = renderOptimizer({ items });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(updateItem).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Everything looks good!', { icon: '✨' });
  });

  it('skips optimized items whose id is not in the original list (warns), no update', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Dairy' }];
    optimizeGroceryListMock.mockResolvedValue([
      { id: '1', name: 'Milk', category: 'Dairy' }, // unchanged
      { id: 'ghost', name: 'Ghost', category: 'Other' }, // not in list
    ]);

    const { result, updateItem } = renderOptimizer({ items });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(updateItem).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Everything looks good!', { icon: '✨' });
  });

  it('handles partial failure: one update succeeds, one rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const items: Item[] = [
      { id: 'A', name: 'A', category: 'Old' },
      { id: 'B', name: 'B', category: 'Old' },
    ];
    optimizeGroceryListMock.mockResolvedValue([
      { id: 'A', name: 'A', category: 'New' }, // changed -> succeeds
      { id: 'B', name: 'B', category: 'New' }, // changed -> rejects
    ]);

    const updateItem = vi.fn((item: Item) => {
      if (item.id === 'B') return Promise.reject(new Error('fail'));
      return Promise.resolve();
    });

    const { result } = renderOptimizer({ items, updateItem });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(updateItem).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith(
      'Optimized 1 items, but 1 updates failed.',
      { icon: '⚠️' }
    );
  });

  it('shows the error toast when all updates fail (updatedCount=0)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Old' }];
    optimizeGroceryListMock.mockResolvedValue([
      { id: '1', name: 'Milk', category: 'New' }, // changed -> rejects
    ]);

    const updateItem = vi.fn(() => Promise.reject(new Error('fail')));
    const { result } = renderOptimizer({ items, updateItem });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to optimize list. Please try again.');
  });

  it('catches an AI-call rejection and shows the error message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Dairy' }];
    optimizeGroceryListMock.mockRejectedValue(new Error('network down'));

    const { result, updateItem } = renderOptimizer({ items });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to optimize list');
    expect(updateItem).not.toHaveBeenCalled();
    expect(result.current.isOptimizing).toBe(false);
  });

  it('uses a custom error message when the AI call rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Dairy' }];
    optimizeGroceryListMock.mockRejectedValue(new Error('boom'));

    const { result } = renderOptimizer({ items, errorMessage: 'Custom failure' });

    await act(async () => {
      await result.current.handleOptimize();
    });

    expect(toast.error).toHaveBeenCalledWith('Custom failure');
  });

  it('toggles isOptimizing true during the call and false after', async () => {
    const items: Item[] = [{ id: '1', name: 'Milk', category: 'Dairy' }];
    let resolveAi: (value: OptimizableItem[]) => void = () => {};
    optimizeGroceryListMock.mockReturnValue(
      new Promise<OptimizableItem[]>((resolve) => {
        resolveAi = resolve;
      })
    );

    const { result } = renderOptimizer({ items });

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.handleOptimize();
      // Let the synchronous setIsOptimizing(true) + dynamic import settle.
      await Promise.resolve();
    });

    expect(result.current.isOptimizing).toBe(true);

    await act(async () => {
      resolveAi([{ id: '1', name: 'Milk', category: 'Dairy' }]);
      await pending;
    });

    expect(result.current.isOptimizing).toBe(false);
  });
});
