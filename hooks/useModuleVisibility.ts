import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useHiddenVisibilityKeys } from '@/hooks/useHiddenVisibilityKeys';
import type { ModuleKey } from '@/types/schema';
import {
  isHomeVisible as isHomeVisiblePure,
  isModuleEnabled as isModuleEnabledPure,
  isPlanVisible as isPlanVisiblePure,
  isPlanTabVisible as isPlanTabVisiblePure,
  type PlanTab,
} from '@/utils/moduleVisibility';

export interface ModuleVisibility {
  /** Whether a given top-level/sub module is enabled for THIS member (fail-open). */
  isModuleEnabled: (key: ModuleKey) => boolean;
  /** Whether the Lists footer page + `/lists` route should be shown. */
  isPlanVisible: boolean;
  /** Whether a given Lists sub-tab + its standalone route should be shown. */
  isPlanTabVisible: (tab: PlanTab) => boolean;
  /**
   * Whether Home (the `/` route + its `BottomNav` item) should be shown for
   * THIS member (2F.2). Home has no household-level toggle, so — unlike
   * `isModuleEnabled` — this reads only the member's hidden-key set.
   */
  isHomeVisible: boolean;
}

/**
 * Live page/module visibility for the signed-in member — Plan 090's
 * per-household layer AND 2F.1's per-member `hiddenKeys` layer, composed.
 *
 * Reads `householdSettings` (the `moduleVisibility` map) from
 * `useHouseholdCore()` and the hidden-key set from `useHiddenVisibilityKeys()`,
 * so a change to either layer propagates in real time via the existing Firestore
 * `onSnapshot` listeners — no polling. Fail-open: during cold load (settings
 * null) every module reports enabled and no nav leaf is hidden, so children
 * render unchanged.
 *
 * Page-level answers are DERIVED from leaves: `isModuleEnabled('money')` goes
 * false once the member has hidden every Money sub-view, the same way it does
 * when the household turns Money off.
 *
 * ⚠️ The hidden set comes from `useHiddenVisibilityKeys()` — the SAME set
 * `usePageNavigation` renders off, flag-gated leaves included. `BottomNav` and
 * `ModuleRoute` therefore agree with the page about which leaves are reachable;
 * if they didn't, a page could be offered in the nav and then render nothing.
 *
 * The returned object is memoized on the two source identities, so consumers
 * only get a new reference when visibility actually changes.
 */
export const useModuleVisibility = (): ModuleVisibility => {
  const { householdSettings } = useHouseholdCore();
  const hidden = useHiddenVisibilityKeys();
  return useMemo(
    () => ({
      isModuleEnabled: (key: ModuleKey) => isModuleEnabledPure(householdSettings, key, hidden),
      isPlanVisible: isPlanVisiblePure(householdSettings, hidden),
      isPlanTabVisible: (tab: PlanTab) => isPlanTabVisiblePure(householdSettings, tab, hidden),
      isHomeVisible: isHomeVisiblePure(hidden),
    }),
    [householdSettings, hidden],
  );
};
