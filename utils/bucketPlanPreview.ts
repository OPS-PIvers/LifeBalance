import { type Account } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { OVER_ALLOCATION_MIN_SHORTFALL } from '@/utils/budgetFit';
import { parseBalanceDraft } from '@/utils/payPeriodCeremony';
import { sumMoney, subtractMoney, roundMoney } from '@/utils/money';

/**
 * PR B1 — "does my plan fit" projection for the bucket-budget editor.
 *
 * {@link computeBudgetFit} answers the question for the budgets that are
 * ALREADY SAVED. This module answers it for the budgets the user is currently
 * TYPING, so the pay-period ceremony's fit meter can move as they edit. It is
 * a projection, not a second model: the claim rule is copied from
 * {@link import('@/utils/safeToSpendDistribution').computeSafeToSpendDistribution}
 * — `claim = max(0, limit − (verified + pending))`, an overspent bucket claims
 * 0 and never a negative — and the "does it fit" floor is the SAME
 * {@link OVER_ALLOCATION_MIN_SHORTFALL} the header's amber mark uses, so the
 * ceremony can never say "fits" about a plan the toolbar then marks amber.
 *
 * We cannot delegate to `computeSafeToSpendDistribution` directly here because
 * it takes saved `BudgetBucket`s and a `SafeToSpendBreakdown`; the draft state
 * has neither (a draft is a bucket id + a half-typed number, and the available
 * cash is itself projected from unsaved balance edits). What is shared is the
 * RULE, kept textually adjacent so a change to one is an obvious prompt to
 * change the other.
 */

/** One bucket's in-progress limit — the parsed value of an editor field. */
export interface PlanDraft {
  id: string;
  limit: number;
}

/**
 * Parse a bucket-limit draft from the plan editor.
 *
 * Unlike {@link parseBalanceDraft}, a bucket limit may never be negative — you
 * cannot budget less than nothing — so a negative parses to `null` (invalid)
 * rather than being accepted. Empty and non-finite input is invalid too.
 * Valid input is rounded to whole cents (decimal dollars, never integer cents).
 */
export function parseLimitDraft(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? roundMoney(n) : null;
}

export interface ResolvedPlanDrafts {
  /**
   * Every bucket's EFFECTIVE limit — the parsed draft, falling back to the
   * saved limit when the draft is absent (a bucket the live listener added
   * after mount) or does not parse. Half-typed text is not a plan, so the
   * meter measures the last thing that was.
   */
  effective: PlanDraft[];
  /** Only the buckets whose parsed draft differs from the saved limit — exactly what a save would write. */
  changed: PlanDraft[];
  /** True when any bucket's draft text fails to parse. */
  hasInvalid: boolean;
}

/**
 * Resolve raw editor text into the two lists a plan editor needs: what the fit
 * meter should measure, and what a save would write.
 *
 * Both come out of ONE pass so the meter can never disagree with the save —
 * the figure and the action it describes are derived together, the same
 * discipline `SafeToSpendBreakdown` applies to its own itemizations.
 */
export function resolvePlanDrafts(
  buckets: readonly { id: string; limit: number }[],
  drafts: Record<string, string>,
): ResolvedPlanDrafts {
  const effective: PlanDraft[] = [];
  const changed: PlanDraft[] = [];
  let hasInvalid = false;

  for (const bucket of buckets) {
    const parsed = parseLimitDraft(drafts[bucket.id] ?? String(bucket.limit));
    if (parsed === null) {
      hasInvalid = true;
      effective.push({ id: bucket.id, limit: bucket.limit });
      continue;
    }
    effective.push({ id: bucket.id, limit: parsed });
    if (parsed !== bucket.limit) changed.push({ id: bucket.id, limit: parsed });
  }

  return { effective, changed, hasInvalid };
}

export interface PlanFitPreview {
  /** Σ max(0, draftLimit − spent) across the drafts. */
  claimed: number;
  /** The Safe-to-Spend the plan is measured against. */
  available: number;
  /** available − claimed. Negative means the plan over-claims the cash. */
  leftover: number;
  /** max(0, −leftover), rounded to the cent. */
  shortfall: number;
  /** True while the shortfall stays under the shared noise floor. */
  fits: boolean;
}

/**
 * Project what the household's buckets would claim if these DRAFT limits were
 * saved right now, and whether that plan fits the available cash.
 *
 * `available` is passed in rather than derived, because the ceremony measures
 * against cash that includes unsaved balance edits — see
 * {@link projectedAvailable}.
 */
export function previewPlanFit(
  available: number,
  drafts: PlanDraft[],
  bucketSpentMap: Map<string, BucketSpent>,
): PlanFitPreview {
  const claims = drafts.map(draft => {
    const s = bucketSpentMap.get(draft.id) ?? { verified: 0, pending: 0 };
    const spent = sumMoney([s.verified, s.pending]);
    const remaining = subtractMoney(draft.limit, spent);
    // Mirrors computeSafeToSpendDistribution: an overspent bucket contributes
    // 0, never a negative — it can't hand cash back to the pool.
    return remaining > 0 ? remaining : 0;
  });
  const claimed = sumMoney(claims);
  const leftover = subtractMoney(available, claimed);
  const shortfall = roundMoney(Math.max(0, subtractMoney(0, leftover)));
  return {
    claimed,
    available,
    leftover,
    shortfall,
    fits: shortfall < OVER_ALLOCATION_MIN_SHORTFALL,
  };
}

/**
 * The Safe-to-Spend a plan should be measured against WHILE the user is still
 * editing account balances.
 *
 * The pay-period ceremony asks for a balance true-up first and bucket budgets
 * second, and writes nothing until Save — so the live `safeToSpend` from
 * context is computed from the OLD balances the whole time the editor is open.
 * Measuring a plan against that stale figure would be misleading at the exact
 * moment it matters most (a paycheck just landed and the balance jumped).
 *
 *   available = safeToSpend + Σ (draftBalance − storedBalance)
 *
 * over ACTIVE CHECKING accounts only, because only checking counts toward
 * Safe-to-Spend (savings and credit never do — see CLAUDE.md's Safe-to-Spend
 * section). Editing a savings balance therefore moves net worth but must not
 * move this figure.
 *
 * A draft that is empty or unparseable contributes a 0 delta — the account is
 * treated as unchanged, which is also what the ceremony's save path does with
 * it. A missing draft (an account the live listener added after mount) is the
 * same case.
 */
export function projectedAvailable(
  safeToSpend: number,
  accounts: Account[],
  balanceDrafts: Record<string, string>,
): number {
  const deltas = accounts.flatMap(account => {
    if (account.archived || account.type !== 'checking') return [];
    const raw = balanceDrafts[account.id];
    if (raw === undefined) return [];
    const parsed = parseBalanceDraft(raw);
    if (parsed === null) return [];
    return [subtractMoney(parsed, account.balance)];
  });
  return sumMoney([safeToSpend, ...deltas]);
}
