import { useSyncExternalStore, useCallback } from 'react';

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      // Handle SSR or environments without matchMedia
      if (typeof window === 'undefined' || !window.matchMedia) {
         return () => {};
      }

      const mediaQuery = window.matchMedia(query);
      // 'change' event is modern; 'addListener' is deprecated but legacy
      // Using 'change' is fine for modern React apps
      mediaQuery.addEventListener('change', callback);

      return () => {
        mediaQuery.removeEventListener('change', callback);
      };
    },
    [query]
  );

  const getSnapshot = () => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };

  const getServerSnapshot = () => {
    return false;
  };

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
