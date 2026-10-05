/**
 * Auto-approval for Apple Pay / iOS Shortcut expense captures (quickAddExpense).
 *
 * A capture used to land as `pending_review` every time, so a coffee bought at
 * the same place on the same card for the hundredth time still waited in the
 * Action Queue. The owner's rule: when the household has ALREADY TAUGHT the app
 * where a purchase goes — its bucket AND its account — approve it on arrival;
 * only purchases the app hasn't learned yet go to the queue.
 *
 * "Learned" is deliberately strict, so doubt always falls back to the queue:
 *
 *   CATEGORY  1. a household merchant rule naming a category, else
 *             2. the household's own verified history for this EXACT merchant
 *                text: the most recent {@link HISTORY_DEPTH} categorised rows
 *                must all agree. One disagreement is doubt.
 *             Either way the category must be a bucket that exists today.
 *   ACCOUNT   1. the account the capture already resolved to (card last-4 or
 *                an explicit id), else
 *             2. the account those same history rows agree on.
 *
 * Approving here is exactly what the Action Queue's swipe-approve does
 * (`updateTransactionCategory` with no related habits): the row becomes
 * `verified` under the category and its account balance moves by the row's
 * impact — a charge debits checking, or raises a card's balance owed.
 *
 * Pure: data in, decision out. The endpoint does the reads and the writes.
 */

import { pickMerchantRule, type MerchantRule } from "./merchantRules";
import { BUDGETED_IN_CALENDAR, CREDIT_CARD_CATEGORY, INCOME_CATEGORY } from "./noSpendDay";

/** How many of the most recent same-merchant rows must agree. */
export const HISTORY_DEPTH = 5;

/** Categories that are never a learned budget choice for a new purchase. */
const NOT_A_BUDGET_CHOICE = new Set<string>([
  "",
  "Uncategorized",
  CREDIT_CARD_CATEGORY, // account-routing sentinel
  BUDGETED_IN_CALENDAR, // bill payments
  INCOME_CATEGORY,
]);

/** A verified transaction already stored under the same merchant text. */
export interface LearnedRow {
  category?: string;
  accountId?: string;
  /** yyyy-MM-dd — orders the history, most recent first. */
  date?: string;
}

export interface AutoApproveInput {
  amount: number;
  merchant: string;
  /** Account resolved from the capture itself (card last-4 / explicit id). */
  resolvedAccountId?: string;
  /** The capture was flagged as a possible duplicate — always review. */
  possibleDuplicate: boolean;
  /** Verified rows whose merchant is exactly this capture's merchant. */
  history: readonly LearnedRow[];
  bucketNames: readonly string[];
  accounts: readonly { id: string; type?: string }[];
  merchantRules?: readonly MerchantRule[];
}

export interface AutoApproval {
  category: string;
  accountId: string;
  /** Signed change to the account's stored balance (decimal dollars). */
  balanceDelta: number;
  /** Where the category came from — reported back to the Shortcut. */
  learnedFrom: "rule" | "history";
}

/** All values equal (and at least one) → that value, else undefined. */
function unanimous(values: readonly string[]): string | undefined {
  const [first] = values;
  if (first === undefined) return undefined;
  return values.every((v) => v === first) ? first : undefined;
}

export function decideAutoApprove(input: AutoApproveInput): AutoApproval | null {
  const { amount, merchant, history, bucketNames, accounts } = input;
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  if (input.possibleDuplicate) return null;
  if (!merchant.trim()) return null;

  const buckets = new Set(bucketNames);
  const isBudgetChoice = (c: string | undefined): c is string =>
    typeof c === "string" && !NOT_A_BUDGET_CHOICE.has(c) && buckets.has(c);

  const recent = [...history].sort((a, b) =>
    (a.date ?? "") < (b.date ?? "") ? 1 : (a.date ?? "") > (b.date ?? "") ? -1 : 0
  );

  // --- category ---
  let category: string | undefined;
  let learnedFrom: AutoApproval["learnedFrom"] = "history";
  const rule = pickMerchantRule(merchant, amount, input.merchantRules);
  if (isBudgetChoice(rule?.category)) {
    category = rule.category;
    learnedFrom = "rule";
  } else {
    const categories = recent
      .map((r) => r.category)
      .filter((c): c is string => typeof c === "string" && !NOT_A_BUDGET_CHOICE.has(c))
      .slice(0, HISTORY_DEPTH);
    const agreed = unanimous(categories);
    if (isBudgetChoice(agreed)) category = agreed;
  }
  if (!category) return null;

  // --- account ---
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let accountId: string | undefined =
    input.resolvedAccountId && accountById.has(input.resolvedAccountId)
      ? input.resolvedAccountId
      : undefined;
  if (!accountId) {
    const agreed = unanimous(
      recent
        .map((r) => r.accountId)
        .filter((id): id is string => typeof id === "string" && id !== "")
        .slice(0, HISTORY_DEPTH)
    );
    if (agreed && accountById.has(agreed)) accountId = agreed;
  }
  if (!accountId) return null;

  // Same impact rule as the client's `accountImpactOf` for a charge: a card's
  // balance is debt owed (stored positive), so a charge raises it; anything
  // else is an asset account the purchase is debited from.
  const account = accountById.get(accountId);
  const cents = Math.round(amount * 100);
  const balanceDelta = (account?.type === "credit" ? cents : -cents) / 100;

  return { category, accountId, balanceDelta, learnedFrom };
}
