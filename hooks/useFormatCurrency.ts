import { useCallback } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { formatCurrency, DEFAULT_CURRENCY, type FormatCurrencyOptions } from '@/utils/formatCurrency';

/**
 * Returns a `formatCurrency` bound to the household's configured currency.
 *
 * Components call `const fmt = useFormatCurrency()` and then `fmt(amount)` to get
 * a fully-formatted string (including the currency symbol). The `currency` option
 * is omitted from the caller's signature — it is always the household's currency.
 */
/**
 * The household's configured currency code. Single source of the derivation —
 * callers that need the raw code (e.g. to split a figure into typographic
 * parts) must use this rather than re-deriving from household settings, so
 * they can never disagree with `useFormatCurrency`'s output.
 */
export function useHouseholdCurrency(): string {
  const { householdSettings } = useHouseholdCore();
  return householdSettings?.currency || DEFAULT_CURRENCY;
}

export function useFormatCurrency() {
  const currency = useHouseholdCurrency();
  return useCallback(
    (amount: number, options?: Omit<FormatCurrencyOptions, 'currency'>) =>
      formatCurrency(amount, { ...options, currency }),
    [currency]
  );
}
