import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/**
 * Drives a page's sub-view selection via the URL's `?view=` param (2F.2),
 * mirroring the `?due=` convention Habits' reminder deep link already uses
 * (`pages/Habits.tsx`) — read straight off the router, so the current view
 * survives a refresh, is shareable, and is deep-linkable from a push
 * notification or PWA shortcut (unlike the one-shot `state.tab` convention
 * `useDeepLinkTab` implements, which a refresh or Back loses).
 *
 * Returns the controlled `[value, setValue]` pair to wire into
 * `<Tabs value … onValueChange … />`, the same shape as `useDeepLinkTab`.
 * Switching tabs calls `setValue`, which writes `view` with `{ replace: true }`
 * via `useSearchParams`'s functional updater — that both leaves any OTHER
 * param already on the URL untouched (there's no sibling param on `/budget`
 * today, but this is the same convention `pages/Habits.tsx`'s `clearDueFilter`
 * uses, so a future one — or `?due=` if this hook is ever reused on a page
 * that has it — can't be clobbered), and means switching tabs updates the
 * address bar WITHOUT pushing a history entry: Back still leaves the page in
 * one press rather than stepping back through every tab visited.
 *
 * Still honors the pre-existing `state: { tab }` deep link (`TopToolbar`,
 * `Dashboard`, `SearchOverlay` all `navigate(path, { state: { tab } })`) so
 * none of those callers need to change: the render that detects a new
 * `location.key` (the exact `useDeepLinkTab` pattern) adopts the state value
 * into `value` immediately, so the correct tab paints on the very first
 * render. Mirroring that value into the `view` param and clearing `state` is
 * a SEPARATE effect keyed on `location.key`, deduped via a ref rather than
 * driven by more component state — React Router warns against (and this app's
 * own `react-hooks/set-state-in-effect` rule would flag) calling a state
 * setter synchronously from inside an effect, and `navigate()` during render
 * is unreliable (React Router logs a dev warning and, under test, never
 * actually lands). None of this weakens the read-before-clear contract
 * `useDeepLinkHighlight` depends on: every hook's render-phase read of
 * `location.state` completes before ANY effect for that render runs, so a
 * `highlightId` riding in the same `state` object is still readable there
 * regardless of when this hook's effect fires.
 *
 * An incoming `view` naming an unknown value falls back to `defaultTab`; a
 * known-but-currently-HIDDEN leaf is deliberately NOT filtered here — callers
 * run the returned value through `resolveActiveLocation` (2F.1), which maps a
 * hidden/unknown leaf onto a still-visible one rather than rendering nothing.
 *
 * @param defaultTab the tab shown when no deep-link state or `view` param is present
 * @param validTabs  the allowed tab values; an unknown incoming value is ignored.
 *                   Pass a stable (module-level) array for clarity — it's a
 *                   dependency of the state-mirroring effect below.
 */
export function useViewParam(
  defaultTab: string,
  validTabs: readonly string[]
): [string, (value: string) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const viewParam = searchParams.get('view');
  const [value, setValue] = useState<string>(() =>
    viewParam && validTabs.includes(viewParam) ? viewParam : defaultTab
  );

  // Track the navigation we last consumed, same as `useDeepLinkTab` —
  // `location.key` changes on every navigation (including a repeat deep-link
  // to the same tab), so a fresh arrival is detected on the render it lands.
  const [consumedKey, setConsumedKey] = useState<string | null>(null);
  if (location.key !== consumedKey) {
    setConsumedKey(location.key);
    const requested = (location.state as { tab?: unknown } | null)?.tab;
    if (typeof requested === 'string' && validTabs.includes(requested)) {
      setValue(requested);
    } else if (viewParam && validTabs.includes(viewParam) && viewParam !== value) {
      setValue(viewParam);
    }
  }

  // Mirrors a fresh `state.tab` deep link into the `view` param and clears the
  // state, once per arrival (`appliedKeyRef`, mutated only here — never during
  // render — dedupes against `location.key`). See the doc comment above for
  // why this is a separate effect rather than folded into the render-time
  // check above.
  const appliedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const requested = (location.state as { tab?: unknown } | null)?.tab;
    if (typeof requested !== 'string' || !validTabs.includes(requested)) return;
    if (appliedKeyRef.current === location.key) return;
    appliedKeyRef.current = location.key;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', requested);
    navigate(
      { pathname: location.pathname, search: `?${nextParams.toString()}` },
      { replace: true, state: null }
    );
  }, [location.key, location.pathname, location.state, searchParams, navigate, validTabs]);

  const setActiveView = useCallback(
    (next: string) => {
      setValue(next);
      setSearchParams(
        prev => {
          const updated = new URLSearchParams(prev);
          updated.set('view', next);
          return updated;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  return [value, setActiveView];
}
