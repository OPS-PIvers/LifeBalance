import { useEffect, useState } from 'react';
import { getKidModeEnabled } from '@/services/appConfig';

/**
 * Reads the global `kidModeEnabled` flag (Plan 080) once on mount.
 *
 * Defaults to `false` (dormant) and only becomes true if an operator has explicitly
 * turned Kid Mode on, so the profile switcher and kid views stay hidden by default.
 * `getKidModeEnabled` already fails closed, so any read error leaves this false.
 */
export const useKidModeEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getKidModeEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getKidModeEnabled already fails closed; stay dormant on any error */
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
};
