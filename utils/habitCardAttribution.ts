import { Account, Habit } from '@/types/schema';
import { getCardOwnerUid } from '@/utils/cardOwnership';
import { habitFeedsMemberAttribution, isHouseholdCreditHabit } from '@/utils/habitAttribution';

/**
 * ATTR-1 — WHO a TRANSACTION-FIRED habit completion is credited to.
 *
 * The problem this solves: a manual habit tap has always written
 * `Habit.completedBy` (the per-member attribution layer), but a completion fired
 * by a transaction keyword wrote none — so every automated fire landed in the
 * weekly recap's "unattributed" bucket with nobody's name on it. In the owner's
 * own production data 47 completions in a week produced only 26 attributed, and
 * the entire gap was automated fires.
 *
 * The only signal a transaction carries about WHO spent the money is the CARD:
 * two adults holding separate debit cards on one shared checking account are
 * indistinguishable by account. `Account.cardOwners` (CARD-1) maps a card's
 * last-4 to a member uid, and `Transaction.cardLast4` records which card
 * produced the row — so `cardOwners[transaction.cardLast4]` is the purchaser.
 *
 * Pure — no Firestore, no clock, no side effects — so the client mutation, the
 * Test-Mode mock and any future server path can share ONE rule rather than
 * three that agree by coincidence.
 *
 * ── THE FOUR REASONS THIS RETURNS `null` ───────────────────────────────────
 *
 * Every one of them falls back to exactly today's behaviour (an unattributed
 * completion, scored at the habit's own flame and paid to the pool), so a
 * `null` is never an error and never blocks the fire.
 *
 * 1. 🏁 HOUSEHOLD CREDIT (`Habit.creditMode === 'household'`). This is the
 *    single most important rule here, and it is the owner's explicit
 *    requirement: groceries, dinner out and the liquor store are done FOR the
 *    household, and pinning one spouse's name to them because their card
 *    happened to be in the reader is precisely the outcome the mode exists to
 *    prevent. 15 of this household's habits are deliberately set this way.
 *    Delegated to the shared `isHouseholdCreditHabit` predicate — never
 *    re-implemented — so the automated path and the manual path can never drift
 *    apart on it.
 *
 * 2. ASSIGNED CHORES (`Habit.assignedTo`). A chore's completions belong to its
 *    assignee by definition: its points route to that member's OWN doc
 *    (`habitPointsTargets`), the recap reads its dates straight off
 *    `completedDates` for the assignee, and `habitFeedsMemberAttribution` is
 *    already false for it everywhere else in the codebase. The card owner is
 *    NOT the credit target there (a parent's card buying a kid's chore
 *    supplies), so this path declines to name anybody and leaves chore
 *    behaviour bit-for-bit unchanged. `creditMode` is inert on a chore for the
 *    same reason (`isHouseholdCreditHabit` already requires `!assignedTo`).
 *
 * 3. NO OWNER TO FIND — the row has no `cardLast4` (EVERY transaction written
 *    before that field shipped, plus every hand-entered one), or the card was
 *    never tagged, or the account is untagged/absent. Attribution is
 *    deliberately FORWARD-ONLY: there is no migration and nothing is inferred
 *    from merchant, amount or who happened to press approve.
 *
 * 4. 🛡️ THE UID IS NOT A CURRENT MEMBER. `Account.cardOwners` is a plain map on
 *    the account doc and `firestore.rules` carries no key allowlist for it, so
 *    ANY member can write any string into it and the converter normalizes only
 *    its SHAPE, never its membership. A uid that has left the household — or
 *    was never in it — must not receive points, streaks or a place on the
 *    recap podium, so the roster is the authority and an unrecognised uid falls
 *    back to unattributed.
 */
export interface CardFireAttributionInput {
  /** The habit about to fire. Only the two attribution fields are read. */
  habit: Pick<Habit, 'assignedTo' | 'creditMode'>;
  /**
   * The account the transaction's money moved through — resolved by the SAME
   * `resolveTargetAccount` routing the balance delta uses, so the card is
   * looked up on the account it actually belongs to. `null`/`undefined` (an
   * untagged row with no checking fallback) yields no owner.
   */
  account: Pick<Account, 'cardOwners'> | null | undefined;
  /** `Transaction.cardLast4` — absent on every legacy row. */
  cardLast4: string | null | undefined;
  /**
   * Is `uid` on the household's CURRENT member roster?
   *
   * 🛡️ FAILS CLOSED, unlike `useHabitActions`' `isLiveMember` (which fails OPEN
   * because its job is only to avoid a NOT_FOUND on a deleted doc). Here the
   * question is a security one — "may this uid be credited?" — and the safe
   * answer while the roster is unknown is "nobody", which costs only the
   * attribution itself and leaves the completion scoring exactly as it does
   * today. Callers therefore pass a predicate that returns false for an empty
   * roster.
   */
  isCurrentMember: (uid: string) => boolean;
}

/**
 * The member uid a transaction-fired completion of `habit` should be credited
 * to, or `null` for an unattributed fire. See the module docblock for the four
 * `null` cases — every one of them is today's behaviour, never an error.
 */
export function resolveCardFireAttribution(input: CardFireAttributionInput): string | null {
  const { habit, account, cardLast4, isCurrentMember } = input;

  // 🏁 Household credit writes NO `completedBy` entry, no matter whose card
  // paid. Shared predicate, deliberately not re-derived here.
  if (isHouseholdCreditHabit(habit)) return null;

  // An assigned chore credits its assignee through its own points route; the
  // card owner is not that person, so name nobody.
  if (!habitFeedsMemberAttribution(habit)) return null;

  const ownerUid = getCardOwnerUid(account, cardLast4);
  if (!ownerUid) return null;

  // 🛡️ `cardOwners` is member-writable and unvalidated by the rules — the
  // roster is the only authority on whether this uid may be credited.
  return isCurrentMember(ownerUid) ? ownerUid : null;
}

/**
 * The fail-CLOSED roster predicate this module's callers pass as
 * `isCurrentMember` (see that field's docblock for why it differs from
 * `isLiveMember`). An empty/absent roster means "unknown", and an unknown
 * roster credits nobody.
 */
export function currentMemberPredicate(
  members: readonly { uid: string }[] | null | undefined,
): (uid: string) => boolean {
  const uids = new Set((members ?? []).map(m => m.uid));
  return (uid: string) => uids.has(uid);
}
