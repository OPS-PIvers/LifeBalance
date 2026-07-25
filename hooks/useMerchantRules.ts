import { useMemo } from 'react';

import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { MerchantRule } from '@/types/schema';
import {
  displayMerchant,
  pickMerchantRule,
  merchantSearchTerms,
} from '@/utils/merchantRules';

/** The minimal transaction-like shape every merchant-rule lookup needs. */
export interface MerchantRuleRow {
  merchant: string;
  /** Decimal dollars. Only consulted by amount-qualified rules. */
  amount?: number;
}

export interface MerchantRulesApi {
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

/**
 * Live, per-household merchant rules — the display-time descriptor → friendly
 * name layer (see `utils/merchantRules.ts` for the matching semantics and why
 * renaming is never written back to `Transaction.merchant`).
 *
 * Reads `householdSettings` from `useHouseholdCore()`, so an edited rule
 * propagates through the existing Firestore `onSnapshot` listener and every
 * rendered merchant name updates at once — that instant retroactivity is the
 * whole reason rules are applied at display time rather than baked into the
 * stored row.
 *
 * Fail-open: no rules (cold load, or a household that has never authored one)
 * means every helper returns the raw descriptor, so consumers render exactly as
 * they did before this feature existed.
 *
 * The returned object is memoized on the rules' CONTENT, not on the array's
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
 */
export const useMerchantRules = (): MerchantRulesApi => {
  const { householdSettings } = useHouseholdCore();
  const rawRules = householdSettings?.merchantRules;

  const signature = useMemo(() => JSON.stringify(rawRules ?? []), [rawRules]);
  const rules = useMemo<MerchantRule[]>(() => JSON.parse(signature) as MerchantRule[], [signature]);

  return useMemo(
    () => ({
      rules,
      displayNameFor: (row: MerchantRuleRow) => displayMerchant(row, rules),
      ruleFor: (row: MerchantRuleRow) => pickMerchantRule(row.merchant, row.amount, rules),
      searchTermsFor: (row: MerchantRuleRow) => merchantSearchTerms(row, rules),
    }),
    [rules],
  );
};
