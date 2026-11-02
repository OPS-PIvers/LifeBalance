import { format, parseISO } from 'date-fns';
import type { Household, MoneyTrackingMode } from '@/types/schema';

/**
 * "Bank sync only" — the household's choice to let the nightly bank-email sync
 * (functions/src/quickAdd/bankEmailSync.ts) be the whole truth for
 * Safe-to-Spend instead of reviewing each captured transaction.
 *
 * Why it is safe to drop the pending term in this mode: the sync OVERWRITES
 * the checking balance every morning with the bank's available balance, which
 * already reflects every withdrawal. A `pending_review` row the sync could not
 * match to a bank line would otherwise be subtracted a second time, so the
 * further behind the review queue falls, the lower Safe-to-Spend reads.
 *
 * What the mode changes, and nothing else:
 *  - Safe-to-Spend = checking balance − unpaid bills (no pending spend).
 *  - Transactions stop surfacing for review (Action Queue, nav badge, the
 *    on-open review drawer, the daily briefing's "to review" count).
 * What it deliberately leaves alone:
 *  - No transaction is written or deleted, so switching back restores the
 *    old queue and formula exactly.
 *  - Bills still subtract and still surface in the Action Queue — the sync
 *    pays most of them itself, and a missed bill is real money.
 *
 * Absent/unrecognised ⇒ 'transactions' (today's behavior). Server twin: the
 * daily briefing reads `moneyTracking === 'bank_sync'` directly.
 */
type MoneyTrackingSettings = Pick<Household, 'moneyTracking'> | null | undefined;

export function resolveMoneyTracking(settings: MoneyTrackingSettings): MoneyTrackingMode {
  return settings?.moneyTracking === 'bank_sync' ? 'bank_sync' : 'transactions';
}

export function isBankSyncOnly(settings: MoneyTrackingSettings): boolean {
  return resolveMoneyTracking(settings) === 'bank_sync';
}

/**
 * The balance line's label + subtitle on the Safe-to-Spend breakdown surfaces
 * (drawer + Money → Overview detail), so both say the same thing per mode.
 */
export function balanceLineCopy(
  breakdown: { bankSyncOnly?: true; balanceAsOf?: string },
): { label: string; sub: string } {
  if (!breakdown.bankSyncOnly) return { label: 'Checking balance', sub: 'Available cash' };
  return {
    label: 'Bank balance',
    sub: breakdown.balanceAsOf
      ? `From the bank sync, as of ${format(parseISO(breakdown.balanceAsOf), 'MMM d')}`
      : 'From the nightly bank sync',
  };
}
