import { getLimits, LEGACY_AI_DAILY_QUOTA } from '@/utils/entitlements';
import type { Household } from '@/types/schema';

export interface AiUsageDisplay {
  used: number;
  cap: number;
}

/**
 * F-DASH-06: pure derivation of "X of Y AI requests used today" for the
 * `InsightWidget` caption, mirroring the same cap logic the Developer
 * Console's AI meter uses (`DeveloperConsole.tsx`) and the enforcement in
 * `geminiService.checkAndIncrementAiUsage` — plan-aware cap once billing is
 * live, else the flat legacy quota for everyone.
 *
 * Returns `null` (hide, fail-quiet) when:
 * - there's no household or usage doc yet (nothing has ever called the AI), or
 * - the stored `lastResetDate` isn't today, since the server only resets the
 *   counter lazily on the next call — a stale prior-day count would otherwise
 *   read as "used" today when it's actually 0.
 *
 * Deliberately does NOT hide on `used === 0` for today's date — a fresh reset
 * to 0/cap is still informative ("plenty left today"). The widget itself may
 * choose to hide on zero for other reasons (e.g. no household loaded).
 */
export const getAiUsageDisplay = (
  household: Household | null | undefined,
  billingEnabled: boolean,
  today: string,
): AiUsageDisplay | null => {
  if (!household) return null;
  const usage = household.aiUsage;
  if (!usage || usage.lastResetDate !== today) return null;

  const cap = billingEnabled ? getLimits(household).aiDailyCap : LEGACY_AI_DAILY_QUOTA;
  return { used: usage.dailyCount, cap };
};
