import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { ModuleKey } from '@/types/schema';
import {
  isModuleEnabled as isModuleEnabledPure,
  isPlanVisible as isPlanVisiblePure,
  isPlanTabVisible as isPlanTabVisiblePure,
  type PlanTab,
} from '@/utils/moduleVisibility';

export interface ModuleVisibility {
  /** Whether a given top-level/sub module is enabled (fail-open). */
  isModuleEnabled: (key: ModuleKey) => boolean;
  /** Whether the Plan footer page + `/lists` route should be shown. */
  isPlanVisible: boolean;
  /** Whether a given Plan sub-tab + its standalone route should be shown. */
  isPlanTabVisible: (tab: PlanTab) => boolean;
}

/**
 * Plan 090 (Modular pages) — live, per-household module visibility.
 *
 * Reads `householdSettings` (carries the `moduleVisibility` field) from
 * `useHouseholdCore()`, so toggles propagate in real time via the existing
 * Firestore `onSnapshot` listener — no polling. Fail-open: during cold load
 * (settings null) every module reports enabled, so children render unchanged.
 *
 * The returned object is memoized on the settings object identity, so consumers
 * only get a new reference when the household settings actually change.
 */
export const useModuleVisibility = (): ModuleVisibility => {
  const { householdSettings } = useHouseholdCore();
  return useMemo(
    () => ({
      isModuleEnabled: (key: ModuleKey) => isModuleEnabledPure(householdSettings, key),
      isPlanVisible: isPlanVisiblePure(householdSettings),
      isPlanTabVisible: (tab: PlanTab) => isPlanTabVisiblePure(householdSettings, tab),
    }),
    [householdSettings],
  );
};
