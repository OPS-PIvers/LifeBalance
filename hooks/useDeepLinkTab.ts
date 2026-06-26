import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Drives a page's sub-tab selection so callers elsewhere in the app can
 * deep-link straight to a tab. A trigger (e.g. the toolbar's points glance)
 * navigates to the page's route with `state: { tab: '<value>' }`; this hook
 * reads that state, selects the requested tab, then clears the state so a back
 * navigation or refresh doesn't re-pin the tab.
 *
 * Returns the controlled `[value, setValue]` pair to wire into
 * `<Tabs value … onValueChange … />`.
 *
 * The deep-link is applied during render (keyed on `location.key`) rather than
 * in an effect — the same "adjust state on a changed input" pattern used
 * elsewhere in the app — so there is no cascading-render effect and the correct
 * tab is shown on the very first paint after navigation.
 *
 * @param defaultTab the tab shown when no deep-link state is present
 * @param validTabs  the allowed tab values; an unknown incoming value is ignored.
 *                   Pass a stable (module-level) array for clarity.
 */
export function useDeepLinkTab(
  defaultTab: string,
  validTabs: readonly string[]
): [string, (value: string) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [value, setValue] = useState<string>(defaultTab);

  // Track the navigation we last consumed. `location.key` changes on every
  // navigation (including repeat deep-links to the same path), so a fresh
  // deep-link is detected here on the render it arrives.
  const [consumedKey, setConsumedKey] = useState<string | null>(null);

  if (location.key !== consumedKey) {
    setConsumedKey(location.key);
    const requested = (location.state as { tab?: unknown } | null)?.tab;
    if (typeof requested === 'string' && validTabs.includes(requested)) {
      setValue(requested);
      // Clear the one-shot deep-link state so it doesn't re-apply on back/refresh.
      navigate(location.pathname, { replace: true, state: null });
    }
  }

  return [value, setValue];
}
