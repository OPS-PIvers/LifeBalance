/**
 * Smart defaults for the Action Queue's one-swipe triage gestures.
 *
 * Swipe-right = "instant approve" needs an account (bills) and a category
 * (pending transactions) WITHOUT opening the review panel. These helpers pick
 * the most logical value — history first, sensible fallback second — mirroring
 * the user's mental model: "checking, unless history suggests something
 * different".
 *
 * Pure + dependency-light on purpose (mirrors `utils/transactionMatch.ts`): no
 * React, no Firestore, no toast — data in, suggestion out — so every rule here
 * is trivially unit-testable.
 */
import { addDays, format, isAfter, isValid, parseISO, startOfToday } from 'date-fns';

import { CREDIT_CARD_CATEGORY, type Account, type BudgetBucket, type CalendarItem, type Transaction } from '@/types/schema';
import { matchMerchantNames, type MerchantMatchStrength } from '@/utils/habitSuggestions';

/** Fallback category assigned by AI scans / shortcut stubs when nothing matched. */
const UNCATEGORIZED = 'Uncategorized';

/** Sort key: most recent transaction first (date, then createdAt as tiebreak). */
const byRecency = (a: Transaction, b: Transaction): number => {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const aCreated = a.createdAt ?? '';
  const bCreated = b.createdAt ?? '';
  if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
  return 0;
};

/**
 * Verified transactions matching `name`, most recent first. Reuses the shipped
 * merchant matcher (`matchMerchantNames`, exact/similar/none): exact-identity
 * rows are preferred, and only when NONE exist does the lookup widen to the
 * fuzzier 'similar' tier, so feed variants like "STARBUCKS STORE #08841" still
 * inherit "Starbucks" history without fuzzy rows ever outvoting exact ones.
 */
const verifiedHistoryFor = (name: string, transactions: readonly Transaction[]): Transaction[] => {
  if (!name || !name.trim()) return [];

  // Memoize matchMerchantNames per distinct `other` string: histories repeat the
  // same merchant/store names, and matchMerchantNames re-normalizes + tokenizes on
  // every call, so a local cache avoids redundant regex work. Single-pass with no
  // intermediate arrays keeps GC pressure low when the Action Queue scores many
  // items on a single render.
  const cache = new Map<string, MerchantMatchStrength>();
  const strengthFor = (other: string): MerchantMatchStrength => {
    let cached = cache.get(other);
    if (cached === undefined) {
      cached = matchMerchantNames(name, other);
      cache.set(other, cached);
    }
    return cached;
  };

  const exact: Transaction[] = [];
  const similar: Transaction[] = [];
  for (const tx of transactions) {
    if (tx.status !== 'verified') continue;
    const byMerchant = strengthFor(tx.merchant);
    if (byMerchant === 'exact') { exact.push(tx); continue; }
    const byStore = tx.store ? strengthFor(tx.store) : 'none';
    if (byStore === 'exact') { exact.push(tx); continue; }
    if (byMerchant === 'similar' || byStore === 'similar') similar.push(tx);
  }

  // Exact-identity rows win outright; 'similar' rows apply only when no exact exist.
  const pool = exact.length > 0 ? exact : similar;
  return pool.sort(byRecency);
};

/**
 * The account a swipe-approved BILL should be paid from:
 *   1. the account the calendar item is explicitly tagged to,
 *   2. the account used the last time a same-titled bill was paid
 *      (`payCalendarItem` stamps `accountId` on the transactions it creates),
 *   3. the household's default account (`Household.defaultAccountId`),
 *   4. the checking account.
 * Credit cards are never suggested (bills are paid from checking/savings, same
 * rule as the AccountPicker). Returns `undefined` when no payable account
 * exists — the caller should fall back to opening the picker. `defaultAccountId`
 * is absent for every legacy household, which then behaves exactly as before.
 */
export function suggestAccountForCalendarItem(
  item: Pick<CalendarItem, 'title' | 'accountId'>,
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  defaultAccountId?: string
): Account | undefined {
  const payable = (id: string | undefined): Account | undefined => {
    if (!id) return undefined;
    const account = accounts.find(a => a.id === id);
    return account && account.type !== 'credit' ? account : undefined;
  };

  const tagged = payable(item.accountId);
  if (tagged) return tagged;

  for (const tx of verifiedHistoryFor(item.title, transactions)) {
    const fromHistory = payable(tx.accountId);
    if (fromHistory) return fromHistory;
  }

  const preferred = payable(defaultAccountId);
  if (preferred) return preferred;

  return accounts.find(a => a.type === 'checking');
}

/**
 * The account a swipe-approved pending TRANSACTION should be tagged to, or
 * `undefined` to leave the tag unchanged (untagged transactions already land on
 * checking via `resolveTargetAccount`). History only fills a MISSING tag — an
 * explicit tag (e.g. routed by card-last-4) is never second-guessed, and the
 * household default (`Household.defaultAccountId`, absent for every legacy
 * household) only applies when history has nothing to say.
 */
export function suggestAccountIdForTransaction(
  tx: Pick<Transaction, 'merchant' | 'store' | 'accountId'>,
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  defaultAccountId?: string
): string | undefined {
  if (tx.accountId && accounts.some(a => a.id === tx.accountId)) return undefined;

  for (const past of verifiedHistoryFor(tx.store || tx.merchant, transactions)) {
    if (past.accountId && accounts.some(a => a.id === past.accountId)) {
      return past.accountId;
    }
  }
  if (defaultAccountId && accounts.some(a => a.id === defaultAccountId)) return defaultAccountId;
  return undefined;
}

/**
 * The category a swipe-approved pending TRANSACTION should be verified under:
 *   1. the most common category among verified same-merchant transactions
 *      (ties broken toward the most recently used),
 *   2. the transaction's own category, when it's a real one (not the
 *      "Uncategorized" placeholder),
 *   3. a bucket whose name appears in the merchant (same heuristic
 *      `payCalendarItem` uses for bills).
 * Returns `undefined` when none apply — the caller should open the review
 * panel instead of guessing.
 */
export function suggestCategoryForTransaction(
  tx: Pick<Transaction, 'merchant' | 'store' | 'category'>,
  buckets: readonly Pick<BudgetBucket, 'name'>[],
  transactions: readonly Transaction[]
): string | undefined {
  const history = verifiedHistoryFor(tx.store || tx.merchant, transactions);
  if (history.length > 0) {
    // Majority category; `history` is most-recent-first, so on a tie the
    // category seen earliest in the list (= most recently used) wins.
    const counts = new Map<string, number>();
    let best: string | undefined;
    let bestCount = 0;
    for (const past of history) {
      // CREDIT_CARD_CATEGORY is an account-routing sentinel, not a budget
      // choice — never let credit history suggest it for a new transaction.
      if (!past.category || past.category === UNCATEGORIZED || past.category === CREDIT_CARD_CATEGORY) continue;
      const count = (counts.get(past.category) ?? 0) + 1;
      counts.set(past.category, count);
      if (count > bestCount) {
        best = past.category;
        bestCount = count;
      }
    }
    if (best) return best;
  }

  if (tx.category && tx.category !== UNCATEGORIZED && tx.category !== CREDIT_CARD_CATEGORY) return tx.category;

  const merchant = (tx.merchant || '').toLowerCase();
  const matchedBucket = merchant
    ? buckets.find(b => b.name.length >= 3 && merchant.includes(b.name.toLowerCase()))
    : undefined;
  return matchedBucket?.name;
}

/**
 * The app-wide "defer" date rule (matches `deferCalendarItem` and the to-do
 * defer in the Action Queue): tomorrow, unless the item is already dated in
 * the future — then one day past its current date, so deferring always pushes
 * it forward. An invalid current date defers to tomorrow.
 */
export function nextDeferDate(currentDate: string, today: Date = startOfToday()): string {
  const tomorrow = addDays(today, 1);
  const original = parseISO(currentDate);
  if (!isValid(original)) return format(tomorrow, 'yyyy-MM-dd');
  const deferredFromOriginal = addDays(original, 1);
  return format(isAfter(deferredFromOriginal, tomorrow) ? deferredFromOriginal : tomorrow, 'yyyy-MM-dd');
}
