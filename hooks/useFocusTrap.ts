import { useEffect, useRef } from 'react';

/**
 * Selector matching elements that can receive keyboard focus.
 * Used by the focus trap to enumerate tabbable elements inside a dialog.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // getClientRects() works for fixed-position elements where offsetParent is
    // always null; it returns no rects only when the element is display:none.
    (el) => el.getClientRects().length > 0 || el === document.activeElement
  );

/**
 * Focus trap for modal dialogs / bottom sheets. While `active`:
 * - moves focus into the container on open (first focusable, else the container,
 *   which should carry `tabIndex={-1}`),
 * - traps Tab / Shift+Tab so focus wraps within the container,
 * - restores focus to the previously-focused element on close/unmount.
 *
 * Attach the returned ref to the dialog's content container.
 *
 * No setState is called here, so react-hooks/set-state-in-effect is satisfied.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);

  // Focus on open; restore on close/unmount.
  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (container) {
      const focusables = getFocusableElements(container);
      (focusables[0] ?? container).focus();
    }

    return () => {
      previouslyFocused?.focus?.();
    };
  }, [active]);

  // Trap Tab / Shift+Tab inside the container.
  useEffect(() => {
    if (!active) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        // Nothing focusable inside; keep focus on the container.
        e.preventDefault();
        container.focus();
        return;
      }

      const first = focusables[0]!; // length > 0 checked above
      const last = focusables[focusables.length - 1]!; // length > 0 checked above
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [active]);

  return containerRef;
}
