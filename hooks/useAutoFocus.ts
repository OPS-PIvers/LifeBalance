import { useEffect, useRef } from 'react';

/**
 * Auto-focuses the referenced element on mount — but ONLY on devices with a
 * fine pointer (mouse / trackpad).
 *
 * On touch devices, programmatically focusing an input pops the on-screen
 * keyboard and scrolls the focused field into view. Inside a bottom-sheet
 * Drawer this is jarring: switching tabs (which remounts the tab's first
 * field) would yank the user down and open the keyboard before they've even
 * chosen what to enter. Skipping focus on coarse-pointer / touch devices keeps
 * the drawer stable, while desktop users still get the convenience of a
 * focused first field.
 *
 * Replaces the bare `autoFocus` attribute, which fires on every device.
 *
 * @param enabled set to false to skip auto-focus entirely (e.g. when editing
 *   an existing record where stealing focus is undesirable).
 */
export function useAutoFocus<T extends HTMLElement>(enabled = true) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    // Coarse pointer ⇒ touch device: don't steal focus / open the keyboard.
    if (window.matchMedia('(pointer: coarse)').matches) return;
    ref.current?.focus();
  }, [enabled]);

  return ref;
}
