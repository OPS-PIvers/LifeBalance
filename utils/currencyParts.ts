/**
 * Split a dollar amount into its display parts (currency symbol, integer,
 * decimal separator, fraction, sign) so a caller can typeset each part
 * independently — e.g. the editorial Safe-to-Spend hero renders a large Besley
 * integer with a smaller, muted currency symbol and cents.
 *
 * This deliberately mirrors {@link formatCurrency}'s locale (`en-US`), fraction
 * digits (2), and negative-zero clamp so re-assembling the parts yields exactly
 * the same string as `formatCurrency(amount)` — the hero never disagrees with
 * the ledger figure it sits above.
 */
import { DEFAULT_CURRENCY } from '@/utils/formatCurrency';

export interface CurrencyParts {
  /** True when the (clamped) value is negative. */
  negative: boolean;
  /** Currency symbol, e.g. `'$'` or `'€'`. */
  symbol: string;
  /** Grouped integer digits, e.g. `'1,700'`. */
  integer: string;
  /** Fraction digits (always 2), e.g. `'00'`. */
  fraction: string;
  /** Locale decimal separator, e.g. `'.'`. */
  decimalSeparator: string;
  /** Whether the symbol precedes the integer (prefix vs. suffix currency). */
  symbolFirst: boolean;
}

const buildParts = (value: number, currency: string): Intl.NumberFormatPart[] =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).formatToParts(value);

export function splitCurrencyParts(
  amount: number,
  currency: string = DEFAULT_CURRENCY
): CurrencyParts {
  const raw = Number.isFinite(amount) ? amount : 0;
  // Match formatCurrency: clamp anything that would render as $0.00 to exactly
  // 0 so we never surface a "-$0.00".
  const value = Math.abs(raw) < 0.005 ? 0 : raw;

  let parts: Intl.NumberFormatPart[];
  try {
    parts = buildParts(value, currency);
  } catch {
    // An unknown/invalid currency code throws a RangeError from Intl.
    parts = buildParts(value, DEFAULT_CURRENCY);
  }

  let symbol = '';
  let integer = '';
  let fraction = '';
  let decimalSeparator = '.';
  let negative = false;
  let symbolIndex = -1;
  let integerIndex = -1;

  parts.forEach((part, i) => {
    switch (part.type) {
      case 'currency':
        symbol += part.value;
        if (symbolIndex === -1) symbolIndex = i;
        break;
      case 'minusSign':
        negative = true;
        break;
      case 'integer':
      case 'group':
        integer += part.value;
        if (integerIndex === -1) integerIndex = i;
        break;
      case 'decimal':
        decimalSeparator = part.value;
        break;
      case 'fraction':
        fraction += part.value;
        break;
      default:
        break;
    }
  });

  return {
    negative,
    symbol,
    integer,
    fraction,
    decimalSeparator,
    symbolFirst: symbolIndex === -1 || integerIndex === -1 ? true : symbolIndex < integerIndex,
  };
}
