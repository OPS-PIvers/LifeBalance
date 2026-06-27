import { useEffect, useState } from 'react';
import { getPlaidEnabled } from '@/services/appConfig';

/**
 * Reads the global `plaidEnabled` flag once on mount.
 *
 * Defaults to `false` (dormant); only true if an operator has explicitly turned
 * Plaid on, so the "Connect a bank" entry stays hidden by default.
 * `getPlaidEnabled` already fails closed, so any read error leaves this false.
 */
export const usePlaidEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getPlaidEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getPlaidEnabled already fails closed; stay dormant on any error */
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
};
