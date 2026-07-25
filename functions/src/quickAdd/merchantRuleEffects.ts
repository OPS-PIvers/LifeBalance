/**
 * Server-only glue between a stored household document and the pure merchant-rule
 * matcher in `merchantRules.ts`.
 *
 * Kept OUT of `merchantRules.ts` on purpose: that file is a strict parity twin of
 * `utils/merchantRules.ts` and a test asserts the two agree, so anything with no
 * client counterpart (reading a raw Firestore field, shaping a write, wording a
 * push) belongs here instead of quietly widening the duplicated surface.
 *
 * Still pure and dependency-free — no admin SDK, no clock — so every branch is
 * unit-testable, which matters because the endpoint that calls it
 * (`bankEmailSync.ts`) is not.
 *
 * The invariant these helpers exist to respect: a rule may CLASSIFY a charge
 * (category, bill link, no-spend exemption); it may never rewrite one. Nothing
 * here returns a `merchant` field, and nothing here writes `rule.name` anywhere.
 * The raw bank descriptor stays the transaction's identity key.
 */

import type { MerchantRule } from "./merchantRules";
import type { WithdrawalDecisionKind } from "./noSpendDay";

/**
 * Coerce `household.merchantRules` into rules safe to match against.
 *
 * A row is kept only when it carries the three fields the matcher's determinism
 * depends on (`id`, `pattern`, `createdAt` — the last two being the pattern
 * itself and the tie-breaker). Optional fields are copied only when well-typed,
 * so a half-written rule degrades to a weaker rule rather than throwing at 3am
 * or, worse, applying a `category` that is not a string.
 *
 * Not length-capped: the client bounds the array at `MAX_MERCHANT_RULES` and
 * Firestore bounds the document, and silently dropping the tail here would make
 * a rule stop firing for a reason nothing surfaces.
 */
export function readMerchantRules(raw: unknown): MerchantRule[] {
  if (!Array.isArray(raw)) return [];

  const rules: MerchantRule[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.pattern !== "string") continue;
    if (typeof r.createdAt !== "string") continue;

    rules.push({
      id: r.id,
      pattern: r.pattern,
      createdAt: r.createdAt,
      // `0` is a legitimate amount qualifier (the Apple Pay pre-auth stub), so
      // this tests finiteness, never truthiness.
      ...(typeof r.amount === "number" && Number.isFinite(r.amount) ? { amount: r.amount } : {}),
      ...(typeof r.name === "string" ? { name: r.name } : {}),
      ...(typeof r.category === "string" ? { category: r.category } : {}),
      ...(typeof r.billId === "string" ? { billId: r.billId } : {}),
      ...(r.exempt === true ? { exempt: true } : {}),
    });
  }
  return rules;
}

/**
 * The category-related fields a brand-new bank-sync row is born with.
 *
 * With no rule (or a rule that sets no category) this is byte-for-byte what the
 * endpoint wrote before rules existed: the fallback category, not
 * auto-categorized, flagged for review.
 *
 * With a rule that names a category the row is filed there, marked
 * `autoCategorized`, and `needsCategory` is OMITTED — the household already said
 * where this merchant belongs, so surfacing it in the review queue would be
 * asking a question that has been answered. A blank/whitespace category is
 * treated as no category rather than filing the row under "".
 */
export function ruleCreateCategory(
  rule: MerchantRule | null | undefined,
  fallbackCategory: string
): { category: string; autoCategorized: boolean; needsCategory?: true } {
  const category = rule?.category?.trim();
  if (!category) {
    return { category: fallbackCategory, autoCategorized: false, needsCategory: true };
  }
  return { category, autoCategorized: true };
}

/**
 * Did a rule's `exempt` flag actually do the work of keeping this charge off the
 * no-spend day?
 *
 * Only when nothing else already had. The three counters feed a one-line summary
 * ("Rules: 1 categorized, 1 exempted, 1 to bills"), so they must describe
 * DISJOINT sets of charges — otherwise one charge reads as three.
 *
 *  - `skip_bankref` — an earlier run already recorded, and counted, this charge.
 *  - `pay_bill` — the row is stored under `BUDGETED_IN_CALENDAR`, so
 *    `spendExemption` exempts it as a "bill" before the merchant-rule check is
 *    ever reached. The exemption was free; the rule's contribution was the bill
 *    link, which `ruleBilled` already counts. Without this, a rule carrying both
 *    `billId` and `exempt: true` reports the same charge under two headings.
 *
 * `fill_stub` and `confirm_pending` DO count: those rows carry an ordinary
 * category, so the rule's `exempt` really is what spares the day. (A confirmed
 * row keeps its own merchant rather than the bank descriptor, so whether the
 * rule still matches it tomorrow is a separate question — see `RuleEffectCounts`.)
 */
export function ruleExemptedCharge(
  rule: MerchantRule | null | undefined,
  kind: WithdrawalDecisionKind
): boolean {
  if (rule?.exempt !== true) return false;
  return kind !== "skip_bankref" && kind !== "pay_bill";
}

/** What the household's rules actually did to ONE nightly email. */
export interface RuleEffectCounts {
  /** New rows a rule filed under a category instead of leaving for review. */
  ruleCategorized: number;
  /**
   * Charges IN THIS EMAIL that a rule's `exempt` flag is what keeps off the
   * no-spend day — see {@link ruleExemptedCharge} for the ones that don't count.
   * Not the number of rows the day's verdict exempted: that set also covers rows
   * stored on earlier nights.
   */
  ruleExempted: number;
  /** Bills paid because a rule's `billId` named them. */
  ruleBilled: number;
}

export function emptyRuleEffectCounts(): RuleEffectCounts {
  return { ruleCategorized: 0, ruleExempted: 0, ruleBilled: 0 };
}

/**
 * The rules half of the summary push, as a sentence fragment ending in a space
 * (or "" when the rules did nothing) — same shape as `describeNoSpendFires`, so
 * the caller concatenates without deciding on separators.
 *
 * Counts only, never rule text: iOS truncates a push body and the balance that
 * follows must survive, and a number can't smuggle anything into the
 * notification the way a bank-derived string could.
 */
export function describeRuleEffects(counts: RuleEffectCounts): string {
  const parts: string[] = [];
  if (counts.ruleCategorized > 0) parts.push(`${counts.ruleCategorized} categorized`);
  if (counts.ruleExempted > 0) parts.push(`${counts.ruleExempted} exempted`);
  if (counts.ruleBilled > 0) parts.push(`${counts.ruleBilled} to bills`);
  return parts.length === 0 ? "" : `Rules: ${parts.join(", ")}. `;
}
