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

/** Records are recoverable for this many days after deletion, then purged. */
export const TRASH_RETENTION_DAYS = 30;

/** Domains that participate in the unified trash. Each is a plain single-doc
 *  delete whose original can be re-created verbatim on restore. */
export type TrashDomain =
  | 'todo'
  | 'shoppingItem'
  | 'meal'
  | 'mealPlanItem'
  | 'habit';

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
