/**
 * Currency formatting for Cloud Functions — the **server-side twin** of the root
 * app's `utils/formatCurrency.ts`. It is intentionally duplicated here because the
 * `functions/` package is a separate pnpm package and cannot import from the root
 * app (`@/...` / `utils/...` do not resolve here). Keep the two copies in sync.
 *
 * Money amounts in this app are stored as floating-point **dollars** (not cents),
 * so the value is passed straight through to `Intl.NumberFormat` without any
 * cents conversion. The currency symbol is driven by the `currency` option, which
 * is sourced per-household (the `currency` field on the `households/{id}` doc).
 */

/** ISO-4217 code used when no household currency is configured. */
export const DEFAULT_CURRENCY = "USD";

export interface FormatCurrencyOptions {
  /** ISO-4217 currency code (e.g. 'USD', 'EUR'). Defaults to {@link DEFAULT_CURRENCY}. */
  currency?: string;
  /** Fraction digits to show — `2` for cents, `0` for whole-dollar amounts. Defaults to `2`. */
  decimals?: 0 | 2;
}

/**
 * Format a dollar amount as a localized currency string (e.g. `123.45` → `'$123.45'`).
 *
 * The locale is fixed to `'en-US'` on purpose: output stays deterministic across
 * runtimes and only the *symbol* changes with `currency` (grouping/decimal
 * separators remain US-style). Per-currency locales (e.g. `de-DE` for EUR) are a
 * deliberate future enhancement.
 *
 * A non-finite amount (`null`/`undefined`/`NaN`) is treated as `0`. An invalid
 * `currency` code throws from `Intl` and falls back to formatting with `'USD'`.
 *
 * @example formatCurrency(1234.5, { decimals: 0 }) // '$1,235'
 * @example formatCurrency(1000, { currency: 'EUR' }) // '€1,000.00'
 */
export function formatCurrency(amount: number, options?: FormatCurrencyOptions): string {
  const { currency = DEFAULT_CURRENCY, decimals = 2 } = options ?? {};
  const value = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    // An unknown/invalid currency code throws a RangeError from Intl — fall back
    // to the default currency rather than letting a bad setting crash the response.
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
}
