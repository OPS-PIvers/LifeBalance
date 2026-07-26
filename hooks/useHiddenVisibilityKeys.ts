import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { flagGatedHiddenKeys, resolveHiddenKeys } from '@/utils/moduleVisibility';

/**
 * THE hidden-key set (2F.1) — the single source of truth for "which visibility
 * keys are unreachable for this member right now".
 *
 * It composes the two reasons a key can be hidden:
 *  1. the member's own `hiddenKeys` (falling back to the legacy widget-only
 *     `dashboardHidden`, then to `MEMBER_DEFAULT_HIDDEN_KEYS`), and
 *  2. any leaf whose GLOBAL flag gate is currently off — today just Habits'
 *     Coach behind `powerToolsEnabled` (see `NavFlagGates`).
 *
 * ⚠️ Every consumer of module/page visibility MUST read the set from here —
 * `useModuleVisibility` (what `BottomNav` and `ModuleRoute` consult),
 * `usePageNavigation` (what the pages render off) and `SearchOverlay` all do.
 * Subtracting a flag-gated leaf inside one page only is what previously let the
 * nav offer Habits while the page itself had no reachable view left: the nav and
 * the page computed DIFFERENT reachable-leaf sets, and the member landed on a
 * header with an empty tab strip and no content.
 *
 * Fail-open in every direction: no member (cold load) means only the default
 * hidden widgets, and `usePowerToolsEnabled` defaults to `true` so the gate never
 * hides anything while the flag read is in flight.
 */
export const useHiddenVisibilityKeys = (): ReadonlySet<string> => {
  const { currentUser } = useHouseholdCore();
  // Resolution reads exactly these two member fields; depending on the whole
  // member object would rebuild the set on every unrelated member write (points,
  // fcmTokens, lastSeen…).
  const hiddenKeys = currentUser?.hiddenKeys;
  const dashboardHidden = currentUser?.dashboardHidden;
  const powerTools = usePowerToolsEnabled();
  return useMemo(() => {
    const set = new Set<string>(resolveHiddenKeys({ hiddenKeys, dashboardHidden }));
    for (const key of flagGatedHiddenKeys({ powerTools })) set.add(key);
    return set;
  }, [hiddenKeys, dashboardHidden, powerTools]);
};
