import { useEffect } from 'react';

/**
 * Custom hook to listen for global hotkeys.
 * @param key The key to listen for (e.g., 'k').
 * @param callback The function to call when the hotkey is triggered.
 * @param options Configuration options.
 * @param options.meta If true, requires Cmd (Mac) or Ctrl (Windows/Linux) to be pressed.
 */
export const useHotkey = (
  key: string,
  callback: () => void,
  options: { meta?: boolean } = {}
) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const metaPressed = options.meta ? (e.metaKey || e.ctrlKey) : true;

      if (metaPressed && e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [key, callback, options.meta]);
};
