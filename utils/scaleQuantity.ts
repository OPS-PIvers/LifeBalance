/**
 * Best-effort scaling of a free-text ingredient quantity string by a numeric
 * factor (e.g. "2 cups" x2 -> "4 cups"). `MealIngredient.quantity` is
 * unstructured free text, not a numeric+unit pair, so this only handles the
 * common case: a leading integer, decimal, or simple fraction ("1/2") token
 * followed by the rest of the string (unit + any notes). Anything that
 * doesn't match that shape is returned unchanged rather than throwing, so a
 * malformed/unparseable quantity never blocks the scaling flow.
 */

// Leading numeric token: integer/decimal ("2", "1.5") or simple fraction ("1/2").
const LEADING_NUMBER = /^(\d+\/\d+|\d+(?:\.\d+)?)\s*(.*)$/;

function parseLeadingNumber(token: string): number | null {
  if (token.includes('/')) {
    const parts = token.split('/');
    const numerator = parts[0];
    const denominator = parts[1];
    if (!numerator || !denominator) return null;
    const n = Number(numerator);
    const d = Number(denominator);
    if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
    return n / d;
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

// Format a scaled number back to a compact string: whole numbers stay whole,
// everything else is rounded to at most 2 decimal places with trailing
// zeros/dot trimmed (e.g. 4 -> "4", 1.3333 -> "1.33", 1.5 -> "1.5").
function formatScaledNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Scales the leading numeric quantity of a free-text quantity string by
 * `factor`. Returns the original string unchanged if it doesn't start with a
 * parseable number, if `factor` isn't a positive finite number, or if the
 * input is empty/undefined. Never throws.
 */
export function scaleQuantity(quantity: string | undefined, factor: number): string | undefined {
  if (!quantity) return quantity;
  if (!Number.isFinite(factor) || factor <= 0) return quantity;

  const trimmed = quantity.trim();
  const match = trimmed.match(LEADING_NUMBER);
  if (!match) return quantity;

  const [, numberToken, rest] = match;
  if (!numberToken) return quantity;

  const value = parseLeadingNumber(numberToken);
  if (value === null) return quantity;

  const scaled = value * factor;
  const formattedRest = rest ? ` ${rest}` : '';
  return `${formatScaledNumber(scaled)}${formattedRest}`;
}
