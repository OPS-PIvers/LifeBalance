import { useEffect, useRef } from 'react';
import { getTopOpenDrawerId, type OpenDrawerId } from '@/utils/openDrawerRegistry';

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
 * - moves focus into the container on open — an element marked
 *   `data-autofocus` wins (React's `autoFocus` focuses during commit, but this
 *   effect runs after and would clobber it with the first focusable, usually
 *   the close button), else the first focusable, else the container (which
 *   should carry `tabIndex={-1}`),
 * - traps Tab / Shift+Tab so focus wraps within the container,
 * - restores focus to the previously-focused element on close/unmount.
 *
 * Attach the returned ref to the dialog's content container.
 *
 * `stackId` OPTS THE TRAP INTO THE OPEN-DRAWER STACK, and is the whole reason
 * two sheets can nest. Every trap listens on `document`, and two `Drawer`s
 * portal into `document.body` as SIBLINGS — so while focus sits in the upper
 * sheet, the lower sheet's `container.contains(activeEl)` is false for every
 * element up there. Left ungated, the lower trap concludes focus escaped on
 * EVERY Tab and yanks it back to its own first focusable; the upper trap yanks
 * it back again, and Tab/Shift+Tab do nothing at all in the sheet the user is
 * actually in — a keyboard-only or screen-reader user cannot reach its
 * controls. `Drawer` passes the same id it registers with, so only the topmost
 * sheet acts; this is exactly the scoping Escape already has in `Drawer`.
 *
 * Consumers that are NOT on that stack (`Modal`, `Popover`, `KidDashboard`'s
 * PIN modal, `DayCompleteCelebration`) pass nothing and keep the unconditional
 * behaviour — a bare "bail unless I'm the top drawer" would disable them
 * outright, since `getTopOpenDrawerId()` names some drawer that isn't them.
 *
 * No setState is called here, so react-hooks/set-state-in-effect is satisfied.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, stackId?: OpenDrawerId) {
  const containerRef = useRef<T>(null);

  // Focus on open; restore on close/unmount.
  useEffect(() => {
    if (!active) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    if (container) {
      const preferred = container.querySelector<HTMLElement>('[data-autofocus]');
      const focusables = getFocusableElements(container);
      (preferred ?? focusables[0] ?? container).focus();
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
      // Checked per keystroke, not per effect: a deeper sheet can open and
      // close while this one stays mounted with `active` unchanged.
      if (stackId !== undefined && getTopOpenDrawerId() !== stackId) return;
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
  }, [active, stackId]);

  return containerRef;
}
