import { useEffect, useState } from 'react';
import { getBillingEnabled } from '@/services/appConfig';

/**
 * Reads the global `billingEnabled` flag (Plan 050b) once on mount.
 *
 * Defaults to `false` (dormant) and only becomes true if an operator has explicitly
 * turned billing on, so the entire billing/upgrade UI stays hidden by default.
 * `getBillingEnabled` already fails closed, so any read error leaves this false.
 */
export const useBillingEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getBillingEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getBillingEnabled already fails closed; stay dormant on any error */
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
};
