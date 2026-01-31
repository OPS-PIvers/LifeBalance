import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  // Lazy initialization to avoid hydration mismatch and flash of wrong content
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(query);

    // Update state if it changed between init and effect
    if (mediaQuery.matches !== matches) {
      setMatches(mediaQuery.matches);
    }

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Use the modern 'change' event which is more efficient than 'resize'
    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [query, matches]);

  return matches;
}
