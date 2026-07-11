import { useEffect, useRef } from 'react';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const FLASH_CLASS = 'search-highlight-flash';
const FLASH_DURATION_MS = 1600; // matches the .search-highlight-flash keyframe duration in index.css

/**
 * Scrolls the element tagged `data-highlight-target="<highlightId>"` into
 * view and applies a brief CSS flash (`.search-highlight-flash`, defined in
 * index.css — its own `animation-duration` collapses under the app-wide
 * `prefers-reduced-motion` guard, so no separate reduced-motion branch is
 * needed for the flash itself).
 *
 * Applied imperatively (direct DOM `classList`, not a React prop) so the
 * target row's own component — often a `React.memo` with a narrow field
 * comparator (`HabitCard`, `TransactionItem`) — doesn't need a highlight prop
 * threaded through it just for this transient effect.
 *
 * Pair with `useDeepLinkHighlight`, whose returned id already self-clears —
 * this hook re-runs once per id and is a no-op once cleared. `onBeforeScroll`
 * lets a virtualized list (e.g. `TransactionMasterList`) scroll the item into
 * the render window first (e.g. via `virtualizer.scrollToIndex`) before this
 * hook queries the DOM, or omit it for plain (always-mounted) lists. It is
 * read through a ref so the scroll/flash effect fires once per id even if the
 * callback's identity changes on re-renders it causes (e.g. a virtualized
 * list re-rendering mid-smooth-scroll).
 */
export function useScrollToHighlight(highlightId: string | null, onBeforeScroll?: () => void): void {
  const reducedMotion = useReducedMotion();
  const onBeforeScrollRef = useRef(onBeforeScroll);
  useEffect(() => {
    onBeforeScrollRef.current = onBeforeScroll;
  }, [onBeforeScroll]);

  useEffect(() => {
    if (!highlightId) return;
    onBeforeScrollRef.current?.();

    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    // Give a virtualized list's onBeforeScroll (scrollToIndex) one frame to
    // mount the target row before we look for it in the DOM.
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-highlight-target="${CSS.escape(highlightId)}"]`
      );
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
      el.classList.add(FLASH_CLASS);
      flashTimer = setTimeout(() => el.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (flashTimer) clearTimeout(flashTimer);
      const el = document.querySelector<HTMLElement>(
        `[data-highlight-target="${CSS.escape(highlightId)}"]`
      );
      el?.classList.remove(FLASH_CLASS);
    };
  }, [highlightId, reducedMotion]);
}
