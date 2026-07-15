import { useEffect, useState } from 'react';
import { getPlaidEnabled } from '@/services/appConfig';

/**
 * Reads the global `plaidEnabled` flag once on mount.
 *
 * Defaults to `false` (dormant); only true if an operator has explicitly turned
 * Plaid on, so the "Connect a bank" entry stays hidden by default.
 * `getPlaidEnabled` already fails closed, so any read error leaves this false.
 *
 * Pass the caller's `householdId` (Plan F-PLAT-09) to also resolve `true` when this
 * household is on the `plaidEnabledHouseholds` allowlist, ahead of the global flip.
 * Omit it (or pass `null`) to check the global flag only.
 */
export const usePlaidEnabled = (householdId?: string | null): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getPlaidEnabled(householdId)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getPlaidEnabled already fails closed; stay dormant on any error */
      });
    return () => {
      active = false;
    };
  }, [householdId]);

  return enabled;
};
