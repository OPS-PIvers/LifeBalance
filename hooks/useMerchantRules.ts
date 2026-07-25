import { useCallback, useMemo, useState } from 'react';

import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { MerchantRuleDraft } from '@/contexts/household/mutations/merchantRuleMutations';
import type { MerchantRule } from '@/types/schema';
import {
  displayMerchant,
  pickMerchantRule,
  merchantSearchTerms,
} from '@/utils/merchantRules';

export type { MerchantRuleDraft };

/** The minimal transaction-like shape every merchant-rule lookup needs. */
export interface MerchantRuleRow {
  merchant: string;
  /** Decimal dollars. Only consulted by amount-qualified rules. */
  amount?: number;
}

/** The read half of the API — everything derived purely from the stored rules. */
interface MerchantRulesReadApi {
  /** The household's authored rules (empty array when none / still loading). */
  rules: MerchantRule[];
  /**
   * What to SHOW for a row: the winning rule's friendly name, or the raw bank
   * descriptor when no rule renames it. This is the one function display code
   * should call — never read `transaction.merchant` directly for output.
   */
  displayNameFor: (row: MerchantRuleRow) => string;
  /** The winning rule for a row, or null — for "renamed by ⟨rule⟩" affordances. */
  ruleFor: (row: MerchantRuleRow) => MerchantRule | null;
  /**
   * Raw descriptor + friendly name, for anything that MATCHES text rather than
   * displaying it (global search, habit keyword triggers). Both names match, so
   * a keyword can target a name the user actually chose.
   */
  searchTermsFor: (row: MerchantRuleRow) => string[];
}

/** The write half — the household-doc transactions in `merchantRuleMutations.ts`. */
interface MerchantRulesWriteApi {
  addRule: (draft: MerchantRuleDraft) => Promise<void>;
  updateRule: (id: string, draft: MerchantRuleDraft) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
}

export interface MerchantRulesApi extends MerchantRulesReadApi, MerchantRulesWriteApi {
  /**
   * True while one of this hook instance's writes is in flight — for disabling a
   * save button. Per hook instance, not global: two editors can't confuse each
   * other's spinners.
   */
  saving: boolean;
}

/**
 * Live, per-household merchant rules — the display-time descriptor → friendly
 * name layer (see `utils/merchantRules.ts` for the matching semantics and why
 * renaming is never written back to `Transaction.merchant`), plus the authoring
 * writes that maintain them.
 *
 * Reads `householdSettings` from `useHouseholdCore()`, so an edited rule
 * propagates through the existing Firestore `onSnapshot` listener and every
 * rendered merchant name updates at once — that instant retroactivity is the
 * whole reason rules are applied at display time rather than baked into the
 * stored row. The write side is the same story in reverse: the mutations only
 * touch the household doc, so there is no local optimistic copy to keep in sync.
 *
 * Fail-open: no rules (cold load, or a household that has never authored one)
 * means every helper returns the raw descriptor, so consumers render exactly as
 * they did before this feature existed.
 *
 * MEMOIZATION — read the next two paragraphs before restructuring this.
 *
 * The read helpers are memoized on the rules' CONTENT, not on the array's
 * identity. That distinction matters: the household listener rebuilds the
 * settings object on every snapshot (`{ ...data, id }` in
 * `contexts/household/listeners/coreListeners.ts`), and the household doc is
 * rewritten by ordinary traffic like points updates — so `merchantRules` arrives
 * as a brand-new array reference many times a session while its contents are
 * unchanged. Keying on identity would hand every consumer a fresh
 * `displayNameFor` each time, invalidating their memos; `useDashboardTransactionStats`
 * in particular exists solely to run ONE O(n) pass over all transactions, and it
 * would start re-running that pass on every habit toggle.
 *
 * Serializing is cheap and bounded (`MAX_MERCHANT_RULES` small objects, only on a
 * household-doc change) and the parse hands back a value whose identity changes
 * exactly when the rules really do.
 *
 * `saving` is component state, so it necessarily churns on every save — which is
 * why the read helpers live in their OWN `useMemo` keyed on `[rules]` and the
 * returned object merely SPREADS them. Consumers destructure (`const
 * { displayNameFor } = useMerchantRules()`), so they keep the identity of the
 * helper they took, and a save can no longer invalidate an O(n) transaction
 * pass. Folding everything into one memo would have re-created `displayNameFor`
 * every time `saving` flipped, quietly reintroducing the regression this design
 * exists to prevent.
 */
export const useMerchantRules = (): MerchantRulesApi => {
  const { householdSettings, addMerchantRule, updateMerchantRule, deleteMerchantRule } =
    useHouseholdCore();
  const rawRules = householdSettings?.merchantRules;

  const signature = useMemo(() => JSON.stringify(rawRules ?? []), [rawRules]);
  const rules = useMemo<MerchantRule[]>(() => JSON.parse(signature) as MerchantRule[], [signature]);

  const readApi = useMemo<MerchantRulesReadApi>(
    () => ({
      rules,
      displayNameFor: (row: MerchantRuleRow) => displayMerchant(row, rules),
      ruleFor: (row: MerchantRuleRow) => pickMerchantRule(row.merchant, row.amount, rules),
      searchTermsFor: (row: MerchantRuleRow) => merchantSearchTerms(row, rules),
    }),
    [rules],
  );

  const [saving, setSaving] = useState(false);

  /**
   * Flag `saving` for the duration of one write. The mutations toast their own
   * errors and then reject, so this only manages the flag and re-throws —
   * letting an editor keep its form open on a failed save.
   */
  const withSaving = useCallback(async (write: () => Promise<void>): Promise<void> => {
    setSaving(true);
    try {
      await write();
    } finally {
      setSaving(false);
    }
  }, []);

  const addRule = useCallback(
    (draft: MerchantRuleDraft) => withSaving(() => addMerchantRule(draft)),
    [withSaving, addMerchantRule],
  );
  const updateRule = useCallback(
    (id: string, draft: MerchantRuleDraft) => withSaving(() => updateMerchantRule(id, draft)),
    [withSaving, updateMerchantRule],
  );
  const deleteRule = useCallback(
    (id: string) => withSaving(() => deleteMerchantRule(id)),
    [withSaving, deleteMerchantRule],
  );

  const writeApi = useMemo<MerchantRulesWriteApi>(
    () => ({ addRule, updateRule, deleteRule }),
    [addRule, updateRule, deleteRule],
  );

  return useMemo(() => ({ ...readApi, ...writeApi, saving }), [readApi, writeApi, saving]);
};
