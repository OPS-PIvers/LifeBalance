import { useEffect, useState } from 'react';
import { getKidModeEnabled } from '@/services/appConfig';

/**
 * Reads the global `kidModeEnabled` flag (Plan 080) once on mount.
 *
 * Defaults to `false` (dormant) and only becomes true if an operator has explicitly
 * turned Kid Mode on, so the profile switcher and kid views stay hidden by default.
 * `getKidModeEnabled` already fails closed, so any read error leaves this false.
 *
 * Pass the caller's `householdId` (Plan F-PLAT-09) to also resolve `true` when this
 * household is on the `kidModeEnabledHouseholds` allowlist, ahead of the global
 * flip. Omit it (or pass `null`) to check the global flag only.
 */
export const useKidModeEnabled = (householdId?: string | null): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getKidModeEnabled(householdId)
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getKidModeEnabled already fails closed; stay dormant on any error */
      });
    return () => {
      active = false;
    };
  }, [householdId]);

  return enabled;
};
