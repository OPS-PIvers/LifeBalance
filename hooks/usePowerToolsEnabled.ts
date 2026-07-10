import { useEffect, useState } from 'react';
import { getPowerToolsEnabled } from '@/services/appConfig';

/**
 * Reads the global `powerToolsEnabled` flag (Plan 17) once on mount.
 *
 * Defaults to `true` (enabled) and only flips off on an explicit read of `false`,
 * so the gated power-user/AI surfaces (HabitCoach, Smart Adjust/Reorder, grocery
 * "Optimize with AI", BudgetHistory, SavedViewChips, YearlyGoal UI) stay visible
 * by default. `getPowerToolsEnabled` already fails open, so any read error leaves
 * this true.
 */
export const usePowerToolsEnabled = (): boolean => {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let active = true;
    getPowerToolsEnabled()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        /* getPowerToolsEnabled already fails open; stay enabled on any error */
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
};
