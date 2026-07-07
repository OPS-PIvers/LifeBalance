import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsLandscape } from './useOrientation';

// Controllable matchMedia stub: exposes the registered 'change' listeners so
// tests can simulate a device rotation without a real media query engine.
const listeners = new Set<() => void>();
let landscape = false;

const installMatchMedia = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === '(orientation: landscape)' ? landscape : false;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_event: string, cb: () => void) => listeners.add(cb),
      removeEventListener: (_event: string, cb: () => void) => listeners.delete(cb),
      dispatchEvent: vi.fn(),
    })),
  });
};

const rotate = (toLandscape: boolean) => {
  landscape = toLandscape;
  act(() => {
    listeners.forEach(cb => cb());
  });
};

describe('useIsLandscape', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    listeners.clear();
    landscape = false;
    installMatchMedia();
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it('reports portrait (false) when the media query does not match', () => {
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(false);
  });

  it('reports landscape (true) when the media query matches on mount', () => {
    landscape = true;
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(true);
  });

  it('updates live when the orientation changes', () => {
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(false);

    rotate(true);
    expect(result.current).toBe(true);

    rotate(false);
    expect(result.current).toBe(false);
  });

  it('unsubscribes its change listener on unmount', () => {
    const { unmount } = renderHook(() => useIsLandscape());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('is SSR-safe: returns false when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useIsLandscape());
    expect(result.current).toBe(false);
  });
});
