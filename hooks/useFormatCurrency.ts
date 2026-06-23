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
export function useFormatCurrency() {
  const { householdSettings } = useHouseholdCore();
  const currency = householdSettings?.currency || DEFAULT_CURRENCY;
  return useCallback(
    (amount: number, options?: Omit<FormatCurrencyOptions, 'currency'>) =>
      formatCurrency(amount, { ...options, currency }),
    [currency]
  );
}
