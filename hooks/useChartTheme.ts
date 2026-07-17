import { useMemo } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { getChartTheme, type ChartTheme } from '@/utils/chartTheme';

/**
 * Theme-aware recharts color palette. Reads `useTheme().resolvedTheme` (never
 * `window.matchMedia` — see PR #994) so chart colors follow the app's own
 * theme toggle/preference, including "system" resolution, rather than the OS
 * setting alone. See `utils/chartTheme.ts` for the palette values and the
 * role each color plays.
 */
export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  return useMemo(() => getChartTheme(resolvedTheme), [resolvedTheme]);
}
