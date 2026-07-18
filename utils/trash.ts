/**
 * Unified trash / recently-deleted recovery (F-XCUT-03).
 *
 * A cross-cutting soft-delete convention: instead of hard-deleting a record,
 * the delete path mirrors the document into the household `trash` subcollection
 * (`households/{id}/trash/{domain}_{originalId}`) inside the SAME writeBatch and
 * removes the original. A "Recently Deleted" view lists these mirrors and a
 * one-tap Restore re-creates the original doc; a scheduled Cloud Function purges
 * anything older than {@link TRASH_RETENTION_DAYS} days.
 *
 * This module is the PURE half — domain metadata plus the TTL / display helpers.
 * The Firestore-touching soft-delete / restore / listener live in
 * `contexts/household/mutations/trashMutations.ts`.
 */

import type { Account, Transaction } from '@/types/schema';
import { accountImpactOf, resolveTargetAccount } from '@/utils/accountImpact';
import { formatCurrency } from '@/utils/formatCurrency';
import { roundMoney } from '@/utils/money';

/** Records are recoverable for this many days after deletion, then purged. */
export const TRASH_RETENTION_DAYS = 30;

/** Domains that participate in the unified trash. Most are plain single-doc
 *  deletes whose original can be re-created verbatim on restore; `transaction`
 *  additionally re-applies its account-balance impact on restore (mirroring the
 *  reversal `deleteTransaction` performed) — see
 *  {@link transactionRestoreImpact} and `trashMutations.restoreTrashedItem`. */
export type TrashDomain =
  | 'todo'
  | 'shoppingItem'
  | 'meal'
  | 'mealPlanItem'
  | 'habit'
  | 'transaction';

export interface TrashDomainMeta {
  /** Source subcollection under `households/{id}/` the record was deleted from. */
  collection: string;
  /** Human-readable singular label for the domain. */
  label: string;
}

export const TRASH_DOMAIN_META: Record<TrashDomain, TrashDomainMeta> = {
  todo: { collection: 'todos', label: 'To-do' },
  shoppingItem: { collection: 'shoppingList', label: 'Shopping item' },
  meal: { collection: 'meals', label: 'Meal' },
  mealPlanItem: { collection: 'mealPlan', label: 'Planned meal' },
  habit: { collection: 'habits', label: 'Habit' },
  transaction: { collection: 'transactions', label: 'Transaction' },
};

/** A soft-deleted record as read back from the `trash` subcollection. */
export interface TrashedItem {
  /** Firestore trash doc id — deterministic `${domain}_${originalId}`. */
  id: string;
  domain: TrashDomain;
  /** Id the record had (and will be restored to) in its source collection. */
  originalId: string;
  /** The sanitized original document data, used to re-create it on restore. */
  data: Record<string, unknown>;
  /** ISO-8601 timestamp of when the record was soft-deleted. */
  deletedAt: string;
  /** UID of the member who deleted it, when known. */
  deletedBy: string | null;
}

/** Deterministic trash doc id so re-deleting the same record is idempotent. */
export function trashDocId(domain: TrashDomain, originalId: string): string {
  return `${domain}_${originalId}`;
}

/** Type guard for the domain union (defends the listener against legacy docs). */
export function isTrashDomain(value: unknown): value is TrashDomain {
  return typeof value === 'string' && value in TRASH_DOMAIN_META;
}

/**
 * True once a trashed item is past its retention window and eligible for purge.
 * A malformed `deletedAt` is treated as NOT expired (fail-safe — never
 * auto-purge something we can't date).
 */
export function isTrashExpired(
  deletedAtISO: string,
  now: Date = new Date(),
  retentionDays: number = TRASH_RETENTION_DAYS
): boolean {
  const deleted = new Date(deletedAtISO).getTime();
  if (Number.isNaN(deleted)) return false;
  const ageMs = now.getTime() - deleted;
  return ageMs >= retentionDays * 24 * 60 * 60 * 1000;
}

/**
 * Whole days remaining before an item is purged (clamped to 0). Returns 0 for a
 * malformed `deletedAt` so the UI degrades to "purges soon" rather than NaN.
 */
export function daysUntilPurge(
  deletedAtISO: string,
  now: Date = new Date(),
  retentionDays: number = TRASH_RETENTION_DAYS
): number {
  const deleted = new Date(deletedAtISO).getTime();
  if (Number.isNaN(deleted)) return 0;
  const purgeAt = deleted + retentionDays * 24 * 60 * 60 * 1000;
  const remainingMs = purgeAt - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

/**
 * Best-effort display title for a trashed record, probing the common name-like
 * fields across domains and falling back to the domain label.
 */
export function trashItemTitle(item: TrashedItem): string {
  const data = item.data;
  const pick = (key: string): string | undefined => {
    const value = data[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  };
  return (
    pick('name') ??
    pick('title') ??
    pick('text') ??
    pick('merchant') ??
    pick('itemName') ??
    TRASH_DOMAIN_META[item.domain].label
  );
}

// ---------------------------------------------------------------------------
// Transaction-specific helpers (Recently Deleted parity for transactions).
// A deleted transaction is mirrored verbatim like every other domain, but its
// restore must also RE-APPLY the balance impact that `deleteTransaction`
// reversed — the pure computation for that lives here so it is unit-testable
// away from Firestore.
// ---------------------------------------------------------------------------

/**
 * Build the trash mirror `data` for a transaction: the full row minus the
 * synthetic `id` (which is never persisted — the converter injects it on read,
 * and the restore path re-creates the doc under `originalId`).
 */
export function transactionTrashData(tx: Transaction): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tx)) {
    if (key === 'id' || value === undefined) continue;
    data[key] = value;
  }
  return data;
}

/**
 * Domain-specific detail line for the Recently Deleted list. For a transaction
 * this is "amount · date" (e.g. `$45.20 · 2026-07-03`) so a row is identifiable
 * beyond its merchant title; other domains have no extra detail (null).
 */
export function trashItemSubtitle(item: TrashedItem): string | null {
  if (item.domain !== 'transaction') return null;
  const parts: string[] = [];
  const amount = item.data.amount;
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    parts.push(formatCurrency(amount));
  }
  const date = item.data.date;
  if (typeof date === 'string' && date.trim()) {
    parts.push(date.trim());
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Outcome of computing the balance side-effect of restoring a transaction. */
export type TransactionRestoreImpact =
  /** Apply `delta` to `accountId`'s balance in the same batch as the restore. */
  | { outcome: 'apply'; accountId: string; delta: number }
  /** No balance movement needed (pending_review, zero/invalid amount, or no
   *  account to route to) — restore the row only. */
  | { outcome: 'none' }
  /** The tagged account no longer exists: restore the row WITHOUT any balance
   *  mutation (safe degradation — see rationale in the function docs). */
  | { outcome: 'missing-account' };

/**
 * Compute the account-balance side-effect of restoring a trashed transaction —
 * the exact inverse of the reversal `deleteTransaction` applied:
 *
 * - `pending_review` never touched a balance, so restoring it must not either.
 * - A verified row re-applies its effective impact on its target account
 *   (income credits, expense debits, credit-card charge raises debt, payment
 *   lowers it — all via {@link accountImpactOf}).
 * - Untagged rows route to the checking account, matching `deleteTransaction`.
 * - If the TAGGED account has been deleted since, we deliberately do NOT use
 *   `resolveTargetAccount`'s checking fallback: the money semantics of the
 *   original account (esp. a credit card's charge/payment signs) don't
 *   translate to checking, so the row is restored with no balance mutation and
 *   the caller explains why. This is the simpler safe option.
 */
export function transactionRestoreImpact(
  data: Record<string, unknown>,
  accounts: Account[]
): TransactionRestoreImpact {
  const amount = data.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return { outcome: 'none' };
  if (data.status !== 'verified') return { outcome: 'none' };

  const accountId =
    typeof data.accountId === 'string' && data.accountId.trim() ? data.accountId.trim() : undefined;
  if (accountId && !accounts.some((a) => a.id === accountId)) {
    return { outcome: 'missing-account' };
  }
  const target = resolveTargetAccount(accountId, accounts);
  if (!target) return { outcome: 'none' };

  const category = typeof data.category === 'string' ? data.category : '';
  const creditPayment = data.creditPayment === true;
  const delta = roundMoney(accountImpactOf({ amount, category, creditPayment }, target));
  if (delta === 0) return { outcome: 'none' };
  return { outcome: 'apply', accountId: target.id, delta };
}
