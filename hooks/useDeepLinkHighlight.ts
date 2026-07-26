import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DEFAULT_DURATION_MS = 2200;

/**
 * Reads a one-shot `highlightId` from router state (set by `SearchOverlay`'s
 * `navigateToResult`, mirroring `useDeepLinkTab`'s `state.tab`) and exposes it
 * as a transient value that self-clears after `durationMs`.
 *
 * This hook does NOT clear `location.state` itself — on pages that also call
 * `useDeepLinkTab`/`useViewParam`, that hook already replaces the history
 * state (clearing `state.tab`) after consuming it on the same render pass;
 * both hooks read `location.state` off the same `location` object before that
 * replace takes effect, so no coordination is needed. On a page with no
 * sibling deep-link hook, the stale `state.highlightId` is harmless — the
 * next navigation to that route away and back will have to supply a fresh
 * one to highlight anything.
 *
 * The render-phase check below only ACTS on a genuine incoming `highlightId`
 * (guarded the same way `useDeepLinkTab` guards its own `requested` value) —
 * it never resets an already-set `highlightId` back to `null` just because a
 * fresh `location.key` arrived with no `highlightId` of its own. That keeps
 * this hook robust against any sibling hook (present or future) that clears
 * `location.state` and, in doing so, forces one more render of this one: that
 * extra render now leaves a real highlight alone instead of wiping it out.
 * The `durationMs` timer below is still what removes a highlight in the
 * normal case — this guard only stops a SPURIOUS early clear.
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
    if (typeof requested === 'string') {
      setHighlightId(requested);
    }
  }

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), durationMs);
    return () => clearTimeout(timer);
  }, [highlightId, durationMs]);

  return highlightId;
}
