import { BucketPeriodSnapshot } from '@/types/schema';
import { roundMoney } from '@/utils/money';

/**
 * utils/payPeriodCeremony.ts — pay-period reset "ceremony".
 *
 * When a paycheck approval rolls the pay period (or initializes period
 * tracking), the mutation emits a {@link PayPeriodCeremonyEvent} on this tiny
 * module-local event bus AFTER its batch commits. The always-mounted layout
 * subscribes and opens the ceremony drawer (recap of the closed period + a
 * prompt to set bucket budgets for the new one).
 *
 * A local event bus — not context state — is deliberate: the ceremony is a
 * device-local, once-per-approval UI moment for the member who confirmed the
 * paycheck. Other household members just see the synced data change; nothing
 * about the ceremony is persisted, and dismissing it has no data effect
 * (bucket limits already carried over unchanged).
 */

export interface PayPeriodCeremonyEvent {
  /** 'roll' = an existing period closed; 'first' = period tracking just initialized. */
  kind: 'roll' | 'first';
  /** Start date (yyyy-MM-dd) of the period that just closed; null for 'first'. */
  previousPeriodId: string | null;
  /** Start date (yyyy-MM-dd) of the new period (= the paycheck date). */
  newPeriodId: string;
  /** Title of the income calendar item that triggered the roll. */
  paycheckTitle: string;
  /** Amount actually received (decimal dollars). */
  paycheckAmount: number;
}

type Listener = (event: PayPeriodCeremonyEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to ceremony events. Returns an unsubscribe function. */
export function subscribePayPeriodCeremony(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Emit a ceremony event to all subscribers (called after the roll commits). */
export function emitPayPeriodCeremony(event: PayPeriodCeremonyEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      // A broken subscriber must never break the money mutation that emitted.
      console.error('[payPeriodCeremony] Listener threw:', error);
    }
  }
}

/**
 * Parse a balance draft from the ceremony's "Update your balances" section.
 * Unlike bucket limits, balances may legitimately be NEGATIVE (overdrawn
 * checking) — only empty / non-finite input is rejected (null). Valid input
 * is rounded to whole cents (decimal dollars, never integer cents).
 */
export function parseBalanceDraft(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

/** How many most-recent period snapshots feed the suggested amount. */
export const SUGGESTION_LOOKBACK_PERIODS = 3;

/** Suggestions round UP to the nearest $5 so they never under-budget the average. */
const SUGGESTION_ROUNDING_DOLLARS = 5;

/**
 * Suggested budget for a bucket in the new period: the average of
 * (totalSpent + totalPending) over the bucket's most recent
 * {@link SUGGESTION_LOOKBACK_PERIODS} snapshots (fewer if that's all that
 * exists — zero-spend periods count), rounded UP to the nearest $5.
 * With no history at all the suggestion is the current limit — effectively
 * "keep the same as last period".
 */
export function suggestBucketLimit(
  bucketId: string,
  currentLimit: number,
  history: BucketPeriodSnapshot[],
): number {
  const snapshots = history
    .filter(s => s.bucketId === bucketId)
    // periodId is yyyy-MM-dd, so string compare sorts newest-first correctly.
    .sort((a, b) => (a.periodId < b.periodId ? 1 : a.periodId > b.periodId ? -1 : 0))
    .slice(0, SUGGESTION_LOOKBACK_PERIODS);

  if (snapshots.length === 0) return currentLimit;

  // Sum in integer cents to avoid float drift before averaging.
  const totalCents = snapshots.reduce(
    (sum, s) => sum + Math.round((s.totalSpent + s.totalPending) * 100),
    0,
  );
  const avgDollars = totalCents / snapshots.length / 100;
  // Clamp at 0: net-negative history (refunds exceeding spending) must not
  // suggest a negative budget, which the editor would reject as invalid.
  return Math.max(0, Math.ceil(avgDollars / SUGGESTION_ROUNDING_DOLLARS) * SUGGESTION_ROUNDING_DOLLARS);
}
