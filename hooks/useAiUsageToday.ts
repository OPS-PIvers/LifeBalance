import { useEffect, useState } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getBillingEnabled } from '@/services/appConfig';
import { getLocalDateString } from '@/utils/dateHelpers';
import { getAiUsageDisplay, type AiUsageDisplay } from '@/utils/aiUsageDisplay';

/**
 * F-DASH-06: "X of Y AI requests used today" for `InsightWidget`.
 *
 * `household.aiUsage` already streams in live via the existing household
 * `onSnapshot` listener (`useHouseholdCore().household`), so no separate read
 * is needed — this hook only adds the async `billingEnabled` flag (mirrors
 * `usePlaidEnabled`/`useKidModeEnabled`) to pick the correct cap, then derives
 * the display via the pure `getAiUsageDisplay`.
 *
 * Returns `null` (hidden) on missing data or a stale reset date — fail-quiet,
 * matching the app's other degrade-gracefully widgets.
 */
export const useAiUsageToday = (): AiUsageDisplay | null => {
  const { household } = useHouseholdCore();
  const [billingEnabled, setBillingEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getBillingEnabled()
      .then((value) => {
        if (active) setBillingEnabled(value);
      })
      .catch(() => {
        /* getBillingEnabled already fails closed; stay off on any error */
      });
    return () => {
      active = false;
    };
  }, []);

  return getAiUsageDisplay(household, billingEnabled, getLocalDateString());
};
