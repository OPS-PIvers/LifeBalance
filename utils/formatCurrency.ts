/**
 * Currency formatting — a single source of truth for turning a dollar amount
 * into a display string, so call sites never hand-roll `'$' + n.toFixed(2)`.
 *
 * Money amounts in this app are stored as floating-point **dollars** (not cents),
 * so the value is passed straight through to `Intl.NumberFormat` without any
 * cents conversion. The currency symbol is driven by the `currency` option, which
 * is sourced per-household (see `useFormatCurrency`).
 */

/** ISO-4217 code used when no household currency is configured. */
export const DEFAULT_CURRENCY = 'USD';

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
 * browsers and only the *symbol* changes with `currency` (grouping/decimal
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
  const raw = Number.isFinite(amount) ? amount : 0;
  // Clamp anything that would *display* as zero to exactly 0, so callers never
  // render a "-$0.00" (negative zero, or a tiny negative under the rounding
  // threshold for the chosen decimals).
  const value = Math.abs(raw) < (decimals === 2 ? 0.005 : 0.5) ? 0 : raw;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    // An unknown/invalid currency code throws a RangeError from Intl — fall back
    // to the default currency rather than letting a bad setting crash render.
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: DEFAULT_CURRENCY,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
}
