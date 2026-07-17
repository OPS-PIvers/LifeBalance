/**
 * Partner-activity selection (the "since you were here" Dashboard moment).
 *
 * LifeBalance is a HOUSEHOLD app, but the second adult never gets a designed
 * moment of discovering what their partner did — a $120 transaction Jordan
 * added is only ever encountered as an undifferentiated row in a list. This
 * pure selector turns the raw transaction list into a small, attributed digest
 * of what the OTHER household members added since this device last opened the
 * app.
 *
 * Kept free of React/Firestore so it's cheaply unit-tested and reusable.
 *
 * Attribution is read from the transaction's `createdBy` (member uid), which
 * `addTransaction` already writes server-authoritatively. Older docs that
 * predate the field simply lack it — they are treated as unattributed and
 * never surfaced (never break existing data).
 */
import type { Transaction, HouseholdMember } from '@/types/schema';
import { INCOME_CATEGORY } from '@/types/schema';

/** Only surface spending at or above this size — a chore log, not an audit log. */
export const PARTNER_ACTIVITY_MIN_AMOUNT = 20;

/** Cap the digest so the card stays a glance, never a feed. */
export const PARTNER_ACTIVITY_MAX_ITEMS = 4;

export interface PartnerActivityItem {
  /** Transaction id — stable React key + a handle for a future deep-link. */
  id: string;
  /** uid of the member who added it (always another member, never the viewer). */
  memberUid: string;
  /** Resolved display name of that member (attributed items only). */
  memberName: string;
  /** Merchant label for the row. */
  merchant: string;
  /** Signed decimal-dollar amount, exactly as stored on the transaction. */
  amount: number;
  /** ISO timestamp the transaction was created (drives ordering + "x ago"). */
  createdAt: string;
}

export interface SelectPartnerActivityArgs {
  transactions: readonly Transaction[];
  members: readonly HouseholdMember[];
  /**
   * ISO timestamp of this device's previous visit. `null` means there is no
   * recorded prior visit (first run) — the selector returns nothing so a new
   * install is never flooded with backfilled history.
   */
  lastVisitISO: string | null;
  /** uid of the viewing member — their own actions are always filtered out. */
  currentMemberId: string | null | undefined;
  /** Minimum absolute amount to include. Defaults to PARTNER_ACTIVITY_MIN_AMOUNT. */
  minAmount?: number;
  /** Max items to return. Defaults to PARTNER_ACTIVITY_MAX_ITEMS. */
  limit?: number;
}

/**
 * Select the attributed transactions OTHER members added since `lastVisitISO`.
 *
 * Rules (all must hold):
 *  - the transaction carries a `createdBy` that resolves to a known member;
 *  - that member is NOT the current viewer;
 *  - it has a `createdAt` strictly after `lastVisitISO`;
 *  - its absolute amount is ≥ `minAmount`;
 *  - it is not income (household income isn't a "look what I spent" moment).
 *
 * Returns newest-first, capped at `limit`.
 */
export function selectPartnerActivity({
  transactions,
  members,
  lastVisitISO,
  currentMemberId,
  minAmount = PARTNER_ACTIVITY_MIN_AMOUNT,
  limit = PARTNER_ACTIVITY_MAX_ITEMS,
}: SelectPartnerActivityArgs): PartnerActivityItem[] {
  // No recorded prior visit → nothing to surface (don't backfill on first run).
  if (!lastVisitISO) return [];

  const lastVisitMs = Date.parse(lastVisitISO);
  if (Number.isNaN(lastVisitMs)) return [];

  // uid → display name, so an unattributed / stale createdBy is skipped rather
  // than shown as an anonymous row.
  const nameByUid = new Map(members.map(m => [m.uid, m.displayName]));

  const items: PartnerActivityItem[] = [];

  for (const tx of transactions) {
    const memberUid = tx.createdBy;
    if (!memberUid) continue; // legacy/unattributed doc
    if (memberUid === currentMemberId) continue; // the viewer's own action
    if (tx.category === INCOME_CATEGORY) continue; // income isn't a spend moment

    const memberName = nameByUid.get(memberUid);
    if (!memberName) continue; // creator no longer a member — don't guess

    if (!tx.createdAt) continue; // no timestamp → can't place it "since you were here"
    const createdMs = Date.parse(tx.createdAt);
    if (Number.isNaN(createdMs) || createdMs <= lastVisitMs) continue;

    if (Math.abs(tx.amount) < minAmount) continue;

    items.push({
      id: tx.id,
      memberUid,
      memberName,
      merchant: tx.merchant,
      amount: tx.amount,
      createdAt: tx.createdAt,
    });
  }

  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return items.slice(0, limit);
}

/**
 * Distinct member names in a digest, in first-appearance (newest-first) order —
 * used to compose the card's summary line ("Jordan and Sam added…").
 */
export function partnerNames(items: readonly PartnerActivityItem[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of items) {
    if (seen.has(item.memberUid)) continue;
    seen.add(item.memberUid);
    names.push(item.memberName);
  }
  return names;
}
