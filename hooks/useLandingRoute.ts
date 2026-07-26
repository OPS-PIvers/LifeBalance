import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useHiddenVisibilityKeys } from '@/hooks/useHiddenVisibilityKeys';
import { resolveLandingRoute } from '@/utils/moduleVisibility';

/**
 * 2F.2 — this member's effective landing route: their CHOSEN `homeScreen` →
 * the FIRST enabled nav destination → `/settings`. Consumed by `HomeRoute`
 * (the `/` route guard, which redirects here whenever Home itself is hidden)
 * and by `MyViewSettings`' landing-screen picker.
 *
 * Reads `homeScreen` directly off `currentUser` (not the whole member object)
 * so this only recomputes on a change to that one field, matching
 * `useHiddenVisibilityKeys`'s narrow-dependency pattern.
 */
export const useLandingRoute = (): string => {
  const { currentUser, householdSettings } = useHouseholdCore();
  const hidden = useHiddenVisibilityKeys();
  const homeScreen = currentUser?.homeScreen;
  return useMemo(
    () => resolveLandingRoute({ homeScreen }, householdSettings, hidden),
    [homeScreen, householdSettings, hidden]
  );
};
