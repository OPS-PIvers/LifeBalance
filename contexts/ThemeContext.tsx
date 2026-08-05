import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Base font scale, applied as a root `%` font-size so all rem-based sizing scales with it. */
export type FontScale = '100' | '115' | '130';

interface ThemeContextValue {
  /** The user's stored preference. */
  theme: ThemePreference;
  /** The actually-applied theme after resolving 'system'. */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
  /** Cycle light → dark (resolving system first). */
  toggleTheme: () => void;
  /** Base font scale preference (100%/115%/130%). */
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  /** High-contrast theme variant, layered on top of light/dark. */
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
}

const STORAGE_KEY = 'LIFEBALANCE_THEME';
const FONT_SCALE_STORAGE_KEY = 'LIFEBALANCE_FONT_SCALE';
const HIGH_CONTRAST_STORAGE_KEY = 'LIFEBALANCE_HIGH_CONTRAST';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const getSystemTheme = (): 'light' | 'dark' =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

/*
  🛡️ The three readers below are MIRRORED by the pre-paint inline script in
  index.html — change both together. These run in a useEffect (after mount,
  after first paint), so index.html stamps the same three <html> attributes
  synchronously in <head> to stop the page repainting under the user: the
  theme class/color-scheme, `data-font-scale` (which scales the ROOT
  font-size, so a mismatch resizes every text node at once) and
  `data-contrast` (which retints the color tokens). If a reader here gains a
  new accepted value or a different default, the inline script must gain it
  too, or the pre-paint value and this post-mount value will disagree and the
  flash comes back.
*/
const readStoredPreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'system';
  try {
    // localStorage access can throw (blocked storage, private mode, older browsers).
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
};

const applyThemeClass = (resolved: 'light' | 'dark') => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
};

const readStoredFontScale = (): FontScale => {
  if (typeof window === 'undefined') return '100';
  try {
    const stored = window.localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return stored === '100' || stored === '115' || stored === '130' ? stored : '100';
  } catch {
    return '100';
  }
};

const readStoredHighContrast = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const applyFontScaleAttr = (scale: FontScale) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-font-scale', scale);
};

const applyContrastAttr = (highContrast: boolean) => {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-contrast', highContrast ? 'high' : 'normal');
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePreference>(readStoredPreference);
  // Tracks the OS scheme; only updated from the matchMedia subscription callback.
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(getSystemTheme);
  const [fontScale, setFontScaleState] = useState<FontScale>(readStoredFontScale);
  const [highContrast, setHighContrastState] = useState<boolean>(readStoredHighContrast);

  // Derived during render — no setState-in-effect needed.
  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? systemTheme : theme;

  // Sync the resolved theme to external systems (DOM class + persisted pref).
  useEffect(() => {
    applyThemeClass(resolvedTheme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      console.warn('Failed to persist theme preference:', e);
    }
  }, [resolvedTheme, theme]);

  // Subscribe to OS scheme changes; setState only fires from the callback.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    // addEventListener is unavailable on MediaQueryList in Safari < 14 / older
    // iOS; fall back to the deprecated addListener for those devices.
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const setTheme = useCallback((next: ThemePreference) => setThemeState(next), []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const current = prev === 'system' ? getSystemTheme() : prev;
      return current === 'dark' ? 'light' : 'dark';
    });
  }, []);

  // Sync font scale to the DOM + persisted pref.
  useEffect(() => {
    applyFontScaleAttr(fontScale);
    try {
      window.localStorage.setItem(FONT_SCALE_STORAGE_KEY, fontScale);
    } catch (e) {
      console.warn('Failed to persist font scale preference:', e);
    }
  }, [fontScale]);

  // Sync high-contrast to the DOM + persisted pref.
  useEffect(() => {
    applyContrastAttr(highContrast);
    try {
      window.localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(highContrast));
    } catch (e) {
      console.warn('Failed to persist high-contrast preference:', e);
    }
  }, [highContrast]);

  const setFontScale = useCallback((next: FontScale) => setFontScaleState(next), []);
  const setHighContrast = useCallback((next: boolean) => setHighContrastState(next), []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolvedTheme,
        setTheme,
        toggleTheme,
        fontScale,
        setFontScale,
        highContrast,
        setHighContrast,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
};
