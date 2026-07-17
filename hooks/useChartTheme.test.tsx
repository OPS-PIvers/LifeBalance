import type { ReactElement, ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { useChartTheme } from './useChartTheme';
import { LIGHT_CHART_THEME, DARK_CHART_THEME } from '@/utils/chartTheme';

const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('useChartTheme', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    // Fixed "light" OS preference so 'system' resolves deterministically and
    // so a matchMedia change alone can never move the resolved chart theme —
    // only the app's own `LIFEBALANCE_THEME` preference should.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
    window.localStorage.clear();
  });

  it('returns the light palette when the stored preference is light', () => {
    window.localStorage.setItem('LIFEBALANCE_THEME', 'light');
    const { result } = renderHook(() => useChartTheme(), { wrapper });
    expect(result.current).toBe(LIGHT_CHART_THEME);
  });

  it('returns the dark palette when the stored preference is dark', () => {
    window.localStorage.setItem('LIFEBALANCE_THEME', 'dark');
    const { result } = renderHook(() => useChartTheme(), { wrapper });
    expect(result.current).toBe(DARK_CHART_THEME);
  });

  it('is stable across re-renders with an unchanged theme (memoized)', () => {
    window.localStorage.setItem('LIFEBALANCE_THEME', 'light');
    const { result, rerender } = renderHook(() => useChartTheme(), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
