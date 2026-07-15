/**
 * Settlement math for F-MONEY-13 (shared expense splitting / IOU tracking).
 *
 * A split transaction carries `splitWith: SplitParticipant[]` — the OTHER
 * people's shares of an expense the payer (`Transaction.createdBy`) fronted.
 * This module nets every household member's unsettled shares across all
 * transactions into a Splitwise-style "who owes whom" list, and provides the
 * client-side validation the split editor uses before saving.
 *
 * Purely functional and money-safe: all arithmetic goes through the integer-cent
 * helpers in `utils/money.ts`, and amounts are decimal dollars everywhere (never
 * cents) to match how they're stored.
 */
import { HouseholdMember, SplitParticipant, Transaction } from '@/types/schema';
import { roundMoney, subtractMoney, sumMoney } from '@/utils/money';

/**
 * Stable identity key for a participant — its member uid, or an `email:`-prefixed
 * key for an external (account-less) participant. Used to address a single share
 * when toggling its `settled` flag.
 */
export function splitParticipantKey(p: SplitParticipant): string {
  if (p.memberId) return `member:${p.memberId}`;
  if (p.email) return `email:${p.email.trim().toLowerCase()}`;
  // Degenerate (neither id nor email) — should never persist; key on the label.
  return `name:${(p.name ?? '').trim().toLowerCase()}`;
}

/** True when a participant is a real household member (vs. an external email). */
export function isMemberParticipant(p: SplitParticipant): boolean {
  return typeof p.memberId === 'string' && p.memberId.length > 0;
}

export interface SplitValidationResult {
  /** True when the shares are individually valid AND sum to at most the total. */
  valid: boolean;
  /** Human-readable reason when `valid` is false; empty otherwise. */
  error: string;
  /** The payer's own remaining share = total − Σ others' shares (≥ 0 when valid). */
  payerRemainder: number;
}

/**
 * Validate a proposed set of split shares against the transaction total.
 *
 * Rules (all client-side UX guards — the overlay never moves money):
 *  - every share must be a finite number ≥ 0;
 *  - the sum of participants' shares must not exceed the (absolute) total;
 *  - each participant must be addressable (a member OR a non-empty email).
 *
 * The payer implicitly keeps `total − Σ shares`, so an exact-total split leaves
 * the payer a $0 remainder (still valid).
 */
export function validateSplit(
  totalAmount: number,
  participants: SplitParticipant[],
): SplitValidationResult {
  const total = roundMoney(Math.abs(totalAmount));

  for (const p of participants) {
    if (typeof p.shareAmount !== 'number' || !isFinite(p.shareAmount) || p.shareAmount < 0) {
      return { valid: false, error: 'Each share must be a positive amount.', payerRemainder: total };
    }
    if (!isMemberParticipant(p) && !(p.email && p.email.trim())) {
      return { valid: false, error: 'Each person needs a household member or an email.', payerRemainder: total };
    }
  }

  const shareSum = sumMoney(participants.map(p => roundMoney(p.shareAmount)));
  if (shareSum > total) {
    return {
      valid: false,
      error: 'Shares add up to more than the transaction total.',
      payerRemainder: subtractMoney(total, shareSum),
    };
  }

  return { valid: true, error: '', payerRemainder: subtractMoney(total, shareSum) };
}

/**
 * Evenly divide `totalAmount` across `count` people, distributing the leftover
 * cents to the earliest shares so the parts sum EXACTLY to the total (no penny
 * lost to rounding). Returns decimal-dollar amounts.
 *
 * @example splitEvenly(10, 3) // [3.34, 3.33, 3.33]
 */
export function splitEvenly(totalAmount: number, count: number): number[] {
  if (count <= 0) return [];
  const totalCents = Math.round(Math.abs(totalAmount) * 100);
  const base = Math.floor(totalCents / count);
  let remainder = totalCents - base * count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const cents = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    out.push(cents / 100);
  }
  return out;
}

/**
 * A directed debt: `fromMemberId` owes `toMemberId` `amount` dollars (amount > 0).
 * The net across every unsettled member↔member share of every split transaction.
 */
export interface PairBalance {
  fromMemberId: string;
  toMemberId: string;
  /** Positive decimal-dollar amount `from` owes `to`. */
  amount: number;
}

function orderedPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Net every unsettled member↔member share into a who-owes-whom list.
 *
 * For each split transaction, the payer is `Transaction.createdBy`; each
 * unsettled participant that is a DIFFERENT household member owes the payer
 * their `shareAmount`. Debts between the same pair net against each other and
 * across directions, so a single positive `PairBalance` remains per pair.
 *
 * External (email) participants are intentionally excluded here — they have no
 * member identity to net against; surface them via {@link computeExternalOwed}.
 */
export function computeMemberBalances(
  transactions: Transaction[],
  members: HouseholdMember[],
): PairBalance[] {
  const memberIds = new Set(members.map(m => m.uid));
  // Directed net in cents, keyed by the ORDERED pair; sign is relative to the
  // lexicographically-smaller uid (positive ⇒ smaller owes larger).
  const netCents = new Map<string, number>();

  for (const tx of transactions) {
    const payer = tx.createdBy;
    if (!payer || !tx.splitWith || tx.splitWith.length === 0) continue;
    if (!memberIds.has(payer)) continue;

    for (const share of tx.splitWith) {
      if (share.settled) continue;
      const debtor = share.memberId;
      if (!debtor || debtor === payer || !memberIds.has(debtor)) continue;

      const cents = Math.round(Math.abs(share.shareAmount) * 100);
      if (cents === 0) continue;

      const key = orderedPairKey(debtor, payer);
      // Debtor owes payer. If debtor is the smaller uid, that's +; else −.
      const signed = debtor < payer ? cents : -cents;
      netCents.set(key, (netCents.get(key) ?? 0) + signed);
    }
  }

  const result: PairBalance[] = [];
  for (const [key, cents] of netCents) {
    if (cents === 0) continue;
    const [smaller, larger] = key.split('|') as [string, string];
    if (cents > 0) {
      result.push({ fromMemberId: smaller, toMemberId: larger, amount: cents / 100 });
    } else {
      result.push({ fromMemberId: larger, toMemberId: smaller, amount: -cents / 100 });
    }
  }
  // Largest debts first for a stable, useful display order.
  return result.sort((a, b) => b.amount - a.amount);
}

/** One external (account-less) person's outstanding split total. */
export interface ExternalOwed {
  email: string;
  name?: string;
  /** Total unsettled decimal-dollar amount owed across all split transactions. */
  amount: number;
  /** True once at least one of this person's shares has an `invitedAt` stamp. */
  invited: boolean;
}

/**
 * Aggregate unsettled external (email) shares by person. These are the people
 * the owner note wants to reach by email — they have no household account to net
 * against, so they're surfaced separately from {@link computeMemberBalances}.
 */
export function computeExternalOwed(transactions: Transaction[]): ExternalOwed[] {
  const byEmail = new Map<string, { name?: string; cents: number; invited: boolean }>();

  for (const tx of transactions) {
    if (!tx.splitWith) continue;
    for (const share of tx.splitWith) {
      if (share.settled || isMemberParticipant(share)) continue;
      const email = share.email?.trim().toLowerCase();
      if (!email) continue;
      const cents = Math.round(Math.abs(share.shareAmount) * 100);
      const existing = byEmail.get(email);
      byEmail.set(email, {
        name: existing?.name ?? share.name,
        cents: (existing?.cents ?? 0) + cents,
        invited: (existing?.invited ?? false) || Boolean(share.invitedAt),
      });
    }
  }

  return Array.from(byEmail.entries())
    .map(([email, v]) => ({ email, name: v.name, amount: v.cents / 100, invited: v.invited }))
    .filter(e => e.amount > 0)
    .sort((a, b) => b.amount - a.amount);
}

/** Look up a member's display name, falling back to a short uid label. */
export function memberDisplayName(memberId: string, members: HouseholdMember[]): string {
  return members.find(m => m.uid === memberId)?.displayName ?? 'Member';
}
