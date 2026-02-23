import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';

/**
 * Custom hook to sync tab state with URL search params.
 *
 * @param defaultTab The default tab value if no query param is present.
 * @param paramName The name of the query param to use (default: 'tab').
 * @returns [currentTab, setTab]
 */
export const useTabFromUrl = (defaultTab: string, paramName: string = 'tab') => {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentTab = searchParams.get(paramName) || defaultTab;

  const setTab = useCallback((newTab: string) => {
    setSearchParams(prev => {
      // Create a new URLSearchParams object to avoid mutating the previous one
      const newParams = new URLSearchParams(prev);
      newParams.set(paramName, newTab);
      return newParams;
    }, { replace: true }); // Replace history entry to avoid back-button clutter
  }, [paramName, setSearchParams]);

  return [currentTab, setTab] as const;
};
