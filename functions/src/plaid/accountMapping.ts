/**
 * Plaid account ↔ LifeBalance account mapping (plan 04, section B).
 *
 * `plaidItems/{itemId}.accountMap` is a `Record<plaidAccountId, lifeBalanceAccountId>`
 * populated automatically at link time (`plaidexchangepublictoken`) by matching
 * each Plaid account against the household's existing LifeBalance accounts —
 * REUSED by both the transaction-routing path (a future wire-in; `mapping.ts`
 * doesn't resolve an account today, see dedup.ts's comment) and the balance-sync
 * path in `sync.ts`, which needs to know which LifeBalance account doc to
 * stamp with `plaidBalanceCurrent`/etc.
 *
 * Matching is intentionally conservative — a wrong auto-match would silently
 * misattribute money, so any Plaid account this module can't confidently place
 * is simply left unmapped (its balance/transactions are skipped until a human
 * maps it via a future settings UI). Confident enough to auto-map:
 *   1. mask (last 4 of account number) equals a LifeBalance account's legacy
 *      `cardLast4`, any entry of `cardLast4s`, or `accountLast4` (the checking
 *      account's own last-4 — Plaid's mask for a depository account is
 *      typically the account number, not a card, so this is often the only
 *      field that matches) — the same signal quickAdd's `accountMatch.ts`
 *      uses, and
 *   2. exact case-insensitive name match, as a fallback when no mask is set.
 * Pure (no Firestore/Plaid SDK imports) so it unit-tests without emulators.
 */

/** Minimal shape of a Plaid account (subset of the SDK's `AccountBase`). */
export interface PlaidAccountInput {
  account_id: string;
  name: string;
  mask: string | null;
}

/** Minimal shape of a LifeBalance account we match against. */
export interface LifeBalanceAccountInput {
  id: string;
  name: string;
  cardLast4?: string;
  cardLast4s?: string[];
  accountLast4?: string;
}

/**
 * Build a `plaidAccountId -> lifeBalanceAccountId` map for one Plaid item's
 * accounts against the household's existing LifeBalance accounts. Plaid
 * accounts with no confident match are simply omitted from the returned map
 * (never guessed) so a wrong auto-match can't misattribute money.
 */
export function resolveAccountMap(
  plaidAccounts: readonly PlaidAccountInput[],
  lifeBalanceAccounts: readonly LifeBalanceAccountInput[],
): Record<string, string> {
  const map: Record<string, string> = {};
  // Each LifeBalance account may be claimed by at most ONE Plaid account —
  // two Plaid accounts mapped to the same target would overwrite each other's
  // balance stamps non-deterministically during sync.
  const claimed = new Set<string>();

  for (const plaidAccount of plaidAccounts) {
    const byMask = plaidAccount.mask
      ? lifeBalanceAccounts.find((a) => {
          if (claimed.has(a.id)) return false;
          const candidates = [
            a.cardLast4,
            ...(a.cardLast4s ?? []),
            a.accountLast4,
          ];
          return candidates.some((c) => c === plaidAccount.mask);
        })
      : undefined;
    if (byMask) {
      map[plaidAccount.account_id] = byMask.id;
      claimed.add(byMask.id);
      continue;
    }

    const byName = lifeBalanceAccounts.find(
      (a) =>
        !claimed.has(a.id) &&
        a.name.trim().toLowerCase() === plaidAccount.name.trim().toLowerCase(),
    );
    if (byName) {
      map[plaidAccount.account_id] = byName.id;
      claimed.add(byName.id);
    }
    // No confident match: leave unmapped rather than guessing.
  }

  return map;
}
