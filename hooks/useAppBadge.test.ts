import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppBadge } from '@/hooks/useAppBadge';

describe('useAppBadge', () => {
  let setAppBadge: ReturnType<typeof vi.fn>;
  let clearAppBadge: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setAppBadge = vi.fn().mockResolvedValue(undefined);
    clearAppBadge = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'setAppBadge', {
      value: setAppBadge,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clearAppBadge', {
      value: clearAppBadge,
      configurable: true,
    });
  });

  afterEach(() => {
    // @ts-expect-error -- tearing down a test-only jsdom property is fine here.
    delete navigator.setAppBadge;
    // @ts-expect-error -- tearing down a test-only jsdom property is fine here.
    delete navigator.clearAppBadge;
    vi.restoreAllMocks();
  });

  it('calls setAppBadge with a positive count', () => {
    renderHook(() => useAppBadge(3));
    expect(setAppBadge).toHaveBeenCalledWith(3);
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('calls clearAppBadge when the count is zero', () => {
    renderHook(() => useAppBadge(0));
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('floors a fractional count', () => {
    renderHook(() => useAppBadge(2.9));
    expect(setAppBadge).toHaveBeenCalledWith(2);
  });

  it('treats a negative count as zero', () => {
    renderHook(() => useAppBadge(-5));
    expect(clearAppBadge).toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('re-invokes on count change', () => {
    const { rerender } = renderHook(({ count }) => useAppBadge(count), {
      initialProps: { count: 1 },
    });
    expect(setAppBadge).toHaveBeenCalledWith(1);
    rerender({ count: 4 });
    expect(setAppBadge).toHaveBeenCalledWith(4);
  });

  it('does not throw when the Badging API is unsupported', () => {
    // @ts-expect-error -- simulating an unsupported browser for this test.
    delete navigator.setAppBadge;
    // @ts-expect-error -- simulating an unsupported browser for this test.
    delete navigator.clearAppBadge;
    expect(() => renderHook(() => useAppBadge(2))).not.toThrow();
  });

  it('does not throw when setAppBadge rejects', async () => {
    setAppBadge.mockRejectedValueOnce(new Error('not installed'));
    expect(() => renderHook(() => useAppBadge(2))).not.toThrow();
  });
});
