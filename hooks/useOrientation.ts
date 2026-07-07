import { useMediaQuery } from './useMediaQuery';

/**
 * Whether the viewport is currently landscape, tracked live via
 * `matchMedia('(orientation: landscape)')` so consumers re-render the
 * instant the device rotates. SSR-safe: environments without `matchMedia`
 * (and the server snapshot) report `false` (portrait) — useMediaQuery
 * already guards both.
 */
export function useIsLandscape(): boolean {
  return useMediaQuery('(orientation: landscape)');
}
