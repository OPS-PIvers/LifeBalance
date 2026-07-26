/**
 * Shopping-item quantity helpers — SERVER copy of the pure `formatQuantity`/
 * `mergeQuantity` logic in `utils/grocerySmartDefaults.ts`.
 *
 * A duplicate, not an import: the client bundle and the Cloud Functions
 * package are separate builds with no shared runtime, exactly as
 * `utils/habitLogic.ts` <-> `functions/src/quickAdd/streakLogic.ts` and
 * `utils/merchantRules.ts` <-> `functions/src/quickAdd/merchantRules.ts`.
 * Only the functions the server actually needs are carried over
 * (`parseQuantity`'s free-text-unit fallback isn't needed here — the shortcut
 * API only ever supplies a bare numeric count, never a unit).
 *
 * Parity is enforced by a test, not by discipline: `quantityLogic.test.ts`
 * imports BOTH this module and `@/utils/grocerySmartDefaults` and asserts
 * identical output over a shared table. functions/tsconfig excludes
 * `*.test.ts` and the suite runs under the root vitest config, so the `@/`
 * alias resolves there. If the two ever diverge, that test fails instead of a
 * quantity merge quietly behaving differently server-side than client-side.
 *
 * Dependency-light on purpose: no firebase, no clock, no side effects. Every
 * function here is pure and total.
 */

/** Matches a leading numeric literal + trailing free text: "2 lbs" -> ["2", " lbs"]. */
const LEADING_NUMBER_RE = /^(\d+(?:\.\d*)?|\.\d+)\s*(.*)$/;

interface ParsedQuantity {
  count: number;
  unit: string;
}

/**
 * Match a leading numeric literal at the start of an already-trimmed string,
 * or `null` when the string doesn't start with a number (e.g. "dozen").
 */
function matchLeadingNumber(trimmed: string): ParsedQuantity | null {
  const match = trimmed.match(LEADING_NUMBER_RE);
  if (!match) return null;
  const [, numStr, rest] = match;
  const count = Number(numStr);
  if (!Number.isFinite(count)) return null;
  return { count, unit: (rest ?? "").trim() };
}

/** Format a parsed quantity back to its display string. */
export function formatQuantity({ count, unit }: ParsedQuantity): string {
  if (count === 1 && unit === "") return "";
  const trimmedUnit = unit.trim();
  return trimmedUnit ? `${count} ${trimmedUnit}` : `${count}`;
}

/**
 * Resolve the quantity field to write on a brand-new shopping-list row: `undefined`
 * (write NO field at all) when the caller supplied no quantity, otherwise the
 * formatted string — which itself collapses a bare count of 1 back to `undefined`,
 * matching the "no explicit quantity means one" convention used everywhere else
 * (a captured single item shouldn't display an invented "1").
 */
export function resolveNewQuantityField(quantity: number | undefined): string | undefined {
  if (quantity === undefined) return undefined;
  const formatted = formatQuantity({ count: quantity, unit: "" });
  return formatted === "" ? undefined : formatted;
}

/**
 * Merge an incoming count into an existing shopping-item quantity, preserving
 * the unit: "2 lbs" + 1 -> "3 lbs". A missing/blank existing quantity counts
 * as 1 for accumulation, so two bare captures of the same item merge into "2"
 * rather than the bump silently vanishing. A quantity with no leading numeric
 * literal (e.g. "dozen") is left untouched — there's no unit-preserving way to
 * add a count to free text, and mangling it (the historical bug: string
 * concatenation, e.g. `currentQty + quantity` on a string field producing
 * "2 lbs1") is worse than a no-op.
 *
 * Accepts `string | number` because existing documents may hold a raw
 * Firestore number for this field (server-written rows before this fix, or
 * legacy client-written ones) — no migration; this reads that shape correctly
 * rather than requiring a backfill.
 */
export function mergeQuantity(
  existing: string | number | null | undefined,
  addCount: number
): string {
  if (existing === null || existing === undefined) {
    return formatQuantity({ count: 1 + addCount, unit: "" });
  }
  const trimmed = String(existing).trim();
  if (trimmed === "") {
    return formatQuantity({ count: 1 + addCount, unit: "" });
  }
  const parsed = matchLeadingNumber(trimmed);
  if (!parsed) {
    return trimmed;
  }
  return formatQuantity({ count: parsed.count + addCount, unit: parsed.unit });
}
