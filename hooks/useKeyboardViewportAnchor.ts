import { useEffect, useRef, useState } from 'react';

/**
 * A visual-viewport shortfall at least this large is treated as the software
 * keyboard (small shrinkages come from browser chrome / rubber-banding).
 */
export const KEYBOARD_MIN_HEIGHT_PX = 120;

/**
 * Anchors the app shell while the iOS software keyboard is open.
 *
 * Why this exists: the main shell is a fixed-height (`overflow-hidden`)
 * layout, so the document itself never scrolls. When the iOS keyboard opens
 * (especially in a standalone PWA), WebKit does not resize the layout
 * viewport — it *pans* the whole window upward to reveal the focused input.
 * That drags the in-flow top header off-screen and shoves `position: fixed`
 * overlays (the toast container) up under the Dynamic Island.
 *
 * The fix, while an editable element **inside the shell** is focused and the
 * visual viewport has shrunk by a keyboard's worth:
 *   1. set `--app-height` on `<html>` to the visual viewport height — the
 *      shell (sized `h-[var(--app-height,100dvh)]`) shrinks to the visible
 *      area, so the header stays put and the inner `<main>` scroller is what
 *      reveals the input;
 *   2. pin the window scroll back to (0,0) whenever WebKit pans it, keeping
 *      fixed overlays (toasts) anchored to the real top of the screen;
 *   3. nudge the focused field into view inside the inner scroller.
 *
 * Scoped to editables *contained in the returned ref's element* on purpose:
 * portal overlays (Drawer/Modal render into `document.body`) are bottom- or
 * center-anchored and rely on WebKit's native pan to stay above the keyboard,
 * so anchoring while they hold focus would trap their inputs behind it.
 *
 * Everything no-ops where `window.visualViewport` is unavailable (jsdom, old
 * browsers), and on platforms whose keyboards resize the layout viewport
 * (Android `resizes-content`) the shortfall stays ~0 so the hook stays inert.
 *
 * `isKeyboardAnchored` mirrors the anchored state so the shell can hide
 * bottom-anchored chrome (the nav bar) while the keyboard is up — a footer
 * pinned directly above the keyboard reads as floating mid-screen.
 */
export function useKeyboardViewportAnchor<T extends HTMLElement>(): {
  shellRef: React.RefObject<T | null>;
  isKeyboardAnchored: boolean;
} {
  const shellRef = useRef<T>(null);
  const [isKeyboardAnchored, setIsKeyboardAnchored] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let anchored = false;
    // Last field scrollIntoView was issued for — repeat viewport resize/scroll
    // events must not re-snap it into view and fight the user's own scrolling.
    let lastRevealed: HTMLElement | null = null;
    let focusRafId: number | null = null;

    const focusedEditableInShell = (): HTMLElement | null => {
      const shell = shellRef.current;
      const el = document.activeElement;
      if (!shell || !(el instanceof HTMLElement) || !shell.contains(el)) return null;
      const tag = el.tagName;
      const isEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
      return isEditable ? el : null;
    };

    const pinWindow = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    };

    const sync = () => {
      // The layout viewport keeps its height while the iOS keyboard is up —
      // only the visual viewport shrinks — so the shortfall measures the
      // keyboard. (clientHeight is 0 in jsdom; fall back to innerHeight.)
      const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
      const keyboardHeight = layoutHeight - vv.height;
      const focused = focusedEditableInShell();
      // Skip while pinch/accessibility-zoomed: the user must be free to pan.
      const shouldAnchor =
        keyboardHeight >= KEYBOARD_MIN_HEIGHT_PX && vv.scale <= 1.02 && focused !== null;

      if (shouldAnchor) {
        document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
        pinWindow();
        anchored = true;
        setIsKeyboardAnchored(true);
        // The shell just shrank to the visible area; let the inner scroller
        // (not a window pan) bring the focused field into view — once per
        // field, so later resize/scroll events don't override user scrolling.
        if (focused !== lastRevealed) {
          lastRevealed = focused;
          requestAnimationFrame(() => {
            if (document.activeElement === focused) focused.scrollIntoView({ block: 'nearest' });
          });
        }
      } else {
        lastRevealed = null;
        if (anchored) {
          document.documentElement.style.removeProperty('--app-height');
          anchored = false;
          setIsKeyboardAnchored(false);
        }
      }
    };

    // Re-check on the next frame: during focusin/focusout, document.activeElement
    // isn't reliably settled yet across browsers. Coalesced so rapid focus
    // transitions schedule a single frame.
    const syncAfterFocusChange = () => {
      if (focusRafId !== null) cancelAnimationFrame(focusRafId);
      focusRafId = requestAnimationFrame(() => {
        focusRafId = null;
        sync();
      });
    };

    // WebKit pans the window during the keyboard animation; undo each pan.
    const onWindowScroll = () => {
      if (anchored) pinWindow();
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('scroll', onWindowScroll);
    document.addEventListener('focusin', syncAfterFocusChange);
    document.addEventListener('focusout', syncAfterFocusChange);

    return () => {
      // A frame surviving unmount would re-run sync() and could re-apply
      // --app-height after this cleanup already removed it.
      if (focusRafId !== null) cancelAnimationFrame(focusRafId);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('scroll', onWindowScroll);
      document.removeEventListener('focusin', syncAfterFocusChange);
      document.removeEventListener('focusout', syncAfterFocusChange);
      document.documentElement.style.removeProperty('--app-height');
    };
  }, []);

  return { shellRef, isKeyboardAnchored };
}
