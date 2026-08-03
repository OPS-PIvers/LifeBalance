/**
 * Card-owner lookup (CARD-1): resolves the household member `uid` tagged as
 * the owner of a specific card last-4 on an account, via `Account.cardOwners`
 * (see the field's doc comment in `types/schema.ts`). The motivating case is
 * two adults with SEPARATE debit cards on one SHARED checking account — the
 * card used is the only available signal for who actually spent the money, so
 * a later PR (not this one) will use this resolver to attribute
 * transaction-fired habit completions to the member who made the purchase.
 * This module is data-model plumbing only — no attribution logic lives here.
 *
 * Deliberately independent of `functions/src/quickAdd/accountMatch.ts`'s
 * last-4 → ACCOUNT routing: tagging an owner on a card never changes which
 * account a transaction routes to, and an account with no `cardOwners` entry
 * (every account that predates this feature) resolves every lookup here to
 * `undefined` — never an error.
 */
import { Account } from '@/types/schema';

/**
 * Normalize a card-last-4 lookup key the same way the digits are normalized
 * everywhere else they're captured (see the duplicated
 * `functions/src/quickAdd/accountMatch.ts#normalizeCardLast4` — this module
 * lives in the root app package, which cannot import from `functions/` (a
 * separate pnpm package), so the small normalization rule is duplicated here
 * rather than shared; keep the two in sync if the rule ever changes).
 * Tolerates "...8899", "…8899", "8899", or a value with surrounding noise;
 * returns the last standalone 4-digit run, or `null` when none is present.
 */
export function normalizeCardDigits(input: unknown): string | null {
  if (typeof input === 'number' && Number.isFinite(input)) {
    input = String(Math.trunc(input));
  }
  if (typeof input !== 'string') return null;
  const matches = input.match(/(?<!\d)\d{4}(?!\d)/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

/**
 * Look up the member `uid` tagged as the owner of `cardLast4` on `account`,
 * or `undefined` when the card carries no owner — either because the card
 * was never tagged, or because `account` has no `cardOwners` map at all (the
 * default for every account that predates this feature). `cardLast4` is
 * normalized before lookup so a caller passing a masked form ("...8899") or a
 * `Transaction.cardLast4` value (already normalized at capture time) both
 * resolve identically.
 */
export function getCardOwnerUid(
  account: Pick<Account, 'cardOwners'> | null | undefined,
  cardLast4: string | null | undefined
): string | undefined {
  const digits = normalizeCardDigits(cardLast4);
  if (!digits || !account?.cardOwners) return undefined;
  return account.cardOwners[digits];
}
