import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { ModuleKey } from '@/types/schema';
import {
  isModuleEnabled as isModuleEnabledPure,
  isPlanVisible as isPlanVisiblePure,
  isPlanTabVisible as isPlanTabVisiblePure,
  resolveHiddenKeySet,
  type PlanTab,
} from '@/utils/moduleVisibility';

export interface ModuleVisibility {
  /** Whether a given top-level/sub module is enabled for THIS member (fail-open). */
  isModuleEnabled: (key: ModuleKey) => boolean;
  /** Whether the Lists footer page + `/lists` route should be shown. */
  isPlanVisible: boolean;
  /** Whether a given Lists sub-tab + its standalone route should be shown. */
  isPlanTabVisible: (tab: PlanTab) => boolean;
}

/**
 * Live page/module visibility for the signed-in member — Plan 090's
 * per-household layer AND 2F.1's per-member `hiddenKeys` layer, composed.
 *
 * Reads `householdSettings` (the `moduleVisibility` map) and `currentUser` (the
 * member's `hiddenKeys`) from `useHouseholdCore()`, so a change to either layer
 * propagates in real time via the existing Firestore `onSnapshot` listeners —
 * no polling. Fail-open: during cold load (settings null) every module reports
 * enabled and no nav leaf is hidden, so children render unchanged.
 *
 * Page-level answers are DERIVED from leaves: `isModuleEnabled('money')` goes
 * false once the member has hidden every Money sub-view, the same way it does
 * when the household turns Money off.
 *
 * The returned object is memoized on the two source identities, so consumers
 * only get a new reference when visibility actually changes.
 */
export const useModuleVisibility = (): ModuleVisibility => {
  const { householdSettings, currentUser } = useHouseholdCore();
  const hiddenKeys = currentUser?.hiddenKeys;
  const dashboardHidden = currentUser?.dashboardHidden;
  // Resolution reads exactly these two fields; depending on the whole member
  // object would rebuild the set on every unrelated member write (points,
  // fcmTokens, lastSeen…).
  const hidden = useMemo(
    () => resolveHiddenKeySet({ hiddenKeys, dashboardHidden }),
    [hiddenKeys, dashboardHidden],
  );
  return useMemo(
    () => ({
      isModuleEnabled: (key: ModuleKey) => isModuleEnabledPure(householdSettings, key, hidden),
      isPlanVisible: isPlanVisiblePure(householdSettings, hidden),
      isPlanTabVisible: (tab: PlanTab) => isPlanTabVisiblePure(householdSettings, tab, hidden),
    }),
    [householdSettings, hidden],
  );
};
