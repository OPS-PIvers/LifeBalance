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

/** What the household's rules actually did to ONE nightly email. */
export interface RuleEffectCounts {
  /** New rows a rule filed under a category instead of leaving for review. */
  ruleCategorized: number;
  /** Charges a rule marks `exempt`, so they can't break the no-spend day. */
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
