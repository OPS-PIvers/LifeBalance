import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import toast from 'react-hot-toast';

import { MAX_MERCHANT_RULES, type MerchantRule } from '@/types/schema';
import { describeError } from '@/utils/errorMessages';
import { generateId } from '@/utils/id';
import { roundMoney } from '@/utils/money';

/**
 * F-MONEY-14 — the WRITE side of merchant rules (the read/display side is
 * `utils/merchantRules.ts` + `hooks/useMerchantRules.ts`).
 *
 * `Household.merchantRules` is a BOUNDED ARRAY on the household document that
 * both members can edit, which makes it exactly the shape that caused the
 * habit-history clobber incident: a device holding a stale snapshot writes the
 * whole array back and silently drops whatever the other device added in the
 * meantime.
 *
 * Why all three mutations use `runTransaction` rather than array operators:
 *   - `arrayRemove`/`arrayUnion` compare by DEEP EQUALITY of the whole element,
 *     so an EDIT (remove-old + union-new) can only work if this client's copy of
 *     the old rule is byte-identical to the server's. It is not, the moment the
 *     partner touched `matchCount`/`lastMatchedAt` — the remove would silently
 *     no-op and the union would append a DUPLICATE rule. `updateRule` and
 *     `deleteRule` therefore have no safe operator form at all.
 *   - `addRule` alone COULD use `arrayUnion`, but the cap in (b) has to be
 *     evaluated against the server's current length, and `arrayUnion` gives no
 *     way to read it. Two devices adding at rule #199 and #200 would both pass a
 *     client-side check and land on 201.
 * A transaction reads the authoritative array and writes a value derived from
 * it, retrying on contention — so a concurrent edit is never lost and the cap is
 * never exceeded. The read is one document the client already has cached, so the
 * cost is a single doc read per save.
 */

/**
 * The user-editable half of a `MerchantRule`. Deliberately excludes `id`,
 * `createdAt`, `matchCount` and `lastMatchedAt`: those are bookkeeping fields
 * owned by this module and the sync pipeline, never by the editor form.
 */
export interface MerchantRuleDraft {
  pattern: string;
  /** Cent-exact qualifier in decimal dollars. Omit for a bare (any-amount) rule. */
  amount?: number;
  /** Friendly display name. Omit for a category-only / bill-only rule. */
  name?: string;
  category?: string;
  /** Calendar item id this descriptor should auto-pay. */
  billId?: string;
  /** Matching charges don't break a no-spend day. */
  exempt?: boolean;
}

/** The draft-owned half of a stored rule: everything except the bookkeeping keys. */
type MerchantRuleFields = Pick<
  MerchantRule,
  'pattern' | 'amount' | 'name' | 'category' | 'billId' | 'exempt'
>;

/**
 * A rejection whose message is already worded for the user (blank pattern, cap
 * reached, rule vanished). Distinguished from an infrastructure failure so the
 * catch block doesn't wrap an already-good message in "Couldn't save…".
 */
class MerchantRuleRejection extends Error {}

/** Trim, and treat a whitespace-only value as "not provided". */
const cleanText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Draft → the fields actually stored on the rule, with every ABSENT optional key
 * OMITTED rather than set to `undefined`.
 *
 * Two reasons this is a separate, exported, unit-tested helper:
 *   1. Firestore REJECTS a literal `undefined` field value (`ignoreUndefined` is
 *      not enabled in `firebase.config.ts`), so `{ name: undefined }` throws at
 *      write time — but only for the drafts that happen to leave a field blank,
 *      which is easy to miss in manual testing.
 *   2. It is what makes CLEARING work. `updateRule` rebuilds the stored rule
 *      from `id`/`createdAt`/bookkeeping + this result instead of spreading the
 *      draft over the old rule, so a field the user emptied is genuinely GONE
 *      from the stored object. A spread-merge would leave the previous value in
 *      place (`{ ...old, ...{ name: undefined } }` keeps `name` as undefined,
 *      and `{ ...old, ...omitted }` keeps the OLD name) — either way the edit
 *      silently fails to clear.
 *
 * Normalization matches the matcher's expectations: text is trimmed (the
 * pattern is uppercased at match time, so it is stored as typed), the amount is
 * rounded to cents like every other money value in the app, and `exempt` is only
 * stored when true — `false` and absent mean the same thing to
 * `functions/src/quickAdd/noSpendDay.ts`, so storing `false` would just be a
 * key that never reads back differently.
 */
export function buildMerchantRuleFields(draft: MerchantRuleDraft): MerchantRuleFields {
  const fields: MerchantRuleFields = { pattern: draft.pattern.trim() };

  if (draft.amount !== undefined && Number.isFinite(draft.amount)) {
    fields.amount = roundMoney(draft.amount);
  }
  const name = cleanText(draft.name);
  if (name !== undefined) fields.name = name;

  const category = cleanText(draft.category);
  if (category !== undefined) fields.category = category;

  const billId = cleanText(draft.billId);
  if (billId !== undefined) fields.billId = billId;

  if (draft.exempt === true) fields.exempt = true;

  return fields;
}

/**
 * Rebuild a stored rule from an edited draft, carrying the bookkeeping fields
 * across (requirement (d)): `createdAt` is the matcher's tie-breaker and must
 * never be re-stamped by an edit, and `matchCount`/`lastMatchedAt` belong to the
 * apply-time pipeline — an edit here must not reset a rule's fire history.
 * Absent bookkeeping keys stay absent, never `undefined`.
 */
function rebuildRule(existing: MerchantRule, draft: MerchantRuleDraft): MerchantRule {
  const next: MerchantRule = {
    id: existing.id,
    createdAt: existing.createdAt,
    ...buildMerchantRuleFields(draft),
  };
  if (existing.lastMatchedAt !== undefined) next.lastMatchedAt = existing.lastMatchedAt;
  if (existing.matchCount !== undefined) next.matchCount = existing.matchCount;
  return next;
}

/** Defensive read of the stored array — a corrupted/legacy value reads as empty. */
function readStoredRules(data: Record<string, unknown> | undefined): MerchantRule[] {
  const stored = data?.merchantRules;
  return Array.isArray(stored) ? (stored as MerchantRule[]) : [];
}

export function makeMerchantRuleMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  /**
   * Read the authoritative `merchantRules`, hand it to `transform`, write back
   * whatever comes out — all inside one transaction. `transform` returning
   * `null` means "nothing to write" (an already-deleted rule), which completes
   * the transaction read-only rather than burning a household-doc write that
   * every listener in the app would have to process.
   *
   * Every failure path toasts and then THROWS, including the user-facing ones:
   * the editor drawer needs one uniform "this did not save" signal so it can
   * keep the user's form open instead of closing it over a discarded edit.
   */
  const commitRules = async (
    hid: string,
    transform: (current: MerchantRule[]) => MerchantRule[] | null,
    failureVerb: string,
  ): Promise<void> => {
    const householdRef = doc(db, 'households', hid);
    try {
      await runTransaction(db, async txn => {
        const snap = await txn.get(householdRef);
        if (!snap.exists()) throw new MerchantRuleRejection('Could not find your household.');
        const next = transform(readStoredRules(snap.data()));
        if (next === null) return;
        txn.update(householdRef, { merchantRules: next });
      });
    } catch (error) {
      if (error instanceof MerchantRuleRejection) {
        toast.error(error.message);
        throw error;
      }
      toast.error(describeError(error, failureVerb));
      throw error;
    }
  };

  /** A pattern that is blank after trimming can never match anything. */
  const requirePattern = (draft: MerchantRuleDraft): void => {
    if (!draft.pattern.trim()) {
      toast.error('Enter some descriptor text for this rule to match.');
      throw new MerchantRuleRejection('blank-pattern');
    }
  };

  const addMerchantRule = async (draft: MerchantRuleDraft): Promise<void> => {
    if (!householdId) return;
    requirePattern(draft);

    const rule: MerchantRule = {
      id: generateId(),
      createdAt: new Date().toISOString(),
      ...buildMerchantRuleFields(draft),
    };

    await commitRules(householdId, current => {
      // (b) Cap checked against the value read INSIDE the transaction, so two
      // devices adding at once can't both squeeze past the limit.
      if (current.length >= MAX_MERCHANT_RULES) {
        throw new MerchantRuleRejection(
          `You've reached the limit of ${MAX_MERCHANT_RULES} merchant rules. Delete one to add another.`,
        );
      }
      return [...current, rule];
    }, 'save the merchant rule');

    toast.success('Merchant rule saved');
  };

  const updateMerchantRule = async (id: string, draft: MerchantRuleDraft): Promise<void> => {
    if (!householdId) return;
    requirePattern(draft);

    await commitRules(householdId, current => {
      const index = current.findIndex(rule => rule.id === id);
      // Not a benign no-op like a double delete: the user is looking at an edit
      // form for a rule that no longer exists, and re-adding it silently would
      // resurrect something the partner deliberately deleted.
      if (index === -1) {
        throw new MerchantRuleRejection('That merchant rule no longer exists.');
      }
      const next = [...current];
      // Non-null assertion is provably safe: `index` came from findIndex on this
      // same array, so the element exists (noUncheckedIndexedAccess widens it).
      next[index] = rebuildRule(current[index]!, draft);
      return next;
    }, 'update the merchant rule');

    toast.success('Merchant rule updated');
  };

  const deleteMerchantRule = async (id: string): Promise<void> => {
    if (!householdId) return;

    await commitRules(householdId, current => {
      const next = current.filter(rule => rule.id !== id);
      // Already gone (the partner deleted it first) — the end state is what the
      // user asked for, so this is a success with no write.
      return next.length === current.length ? null : next;
    }, 'delete the merchant rule');

    toast.success('Merchant rule deleted');
  };

  return { addMerchantRule, updateMerchantRule, deleteMerchantRule };
}
