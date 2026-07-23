import { useLayoutEffect, useRef } from 'react';

/**
 * Second-tier sticky offset for the Plan tabs' stacked headers.
 *
 * ListsPage publishes `--lists-sticky-top` (the tab strip's height) so a tab's
 * title row can pin flush below the strip. This hook publishes the NEXT tier:
 * it measures the title row (via `titleRowRef`) and writes
 * `--lists-sticky-top-2` = `calc(var(--lists-sticky-top, 0px) + <title height>px)`
 * onto the container (via `containerRef`), so the quick-add row can pin flush
 * below the title row. Using `calc()` against the strip's own variable means a
 * strip resize propagates automatically — only the title row needs observing.
 *
 * Written straight to the DOM (no state) — a re-render for a pixel offset
 * would be wasted work — mirroring ListsPage's tab-strip measurement. The
 * no-tab-strip case keeps working through the inner `var(..., 0px)` fallback.
 */
export function useStackedStickyOffset<
  C extends HTMLElement,
  T extends HTMLElement,
>(): {
  containerRef: React.RefObject<C | null>;
  titleRowRef: React.RefObject<T | null>;
} {
  const containerRef = useRef<C>(null);
  const titleRowRef = useRef<T>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const title = titleRowRef.current;
    const update = () => {
      container.style.setProperty(
        '--lists-sticky-top-2',
        `calc(var(--lists-sticky-top, 0px) + ${title ? title.offsetHeight : 0}px)`
      );
    };
    update();
    if (!title || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(title);
    return () => observer.disconnect();
  }, []);

  return { containerRef, titleRowRef };
}
