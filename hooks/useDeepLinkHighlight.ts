import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DEFAULT_DURATION_MS = 2200;

/**
 * Reads a one-shot `highlightId` from router state (set by `SearchOverlay`'s
 * `navigateToResult`, mirroring `useDeepLinkTab`'s `state.tab`) and exposes it
 * as a transient value that self-clears after `durationMs`.
 *
 * This hook does NOT clear `location.state` itself — on pages that also call
 * `useDeepLinkTab`, that hook already replaces the history state (clearing
 * `state.tab`) after consuming it on the same render pass; both hooks read
 * `location.state` off the same `location` object before that replace takes
 * effect, so no coordination is needed. On a page with no `useDeepLinkTab`,
 * the stale `state.highlightId` is harmless — the next navigation to that
 * route away and back will have to supply a fresh one to highlight anything.
 *
 * Consumers combine this with `useScrollToHighlight` (or manual DOM lookup)
 * to scroll a matching row into view and flash it briefly.
 */
export function useDeepLinkHighlight(durationMs: number = DEFAULT_DURATION_MS): string | null {
  const location = useLocation();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [consumedKey, setConsumedKey] = useState<string | null>(null);

  if (location.key !== consumedKey) {
    setConsumedKey(location.key);
    const requested = (location.state as { highlightId?: unknown } | null)?.highlightId;
    setHighlightId(typeof requested === 'string' ? requested : null);
  }

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), durationMs);
    return () => clearTimeout(timer);
  }, [highlightId, durationMs]);

  return highlightId;
}
