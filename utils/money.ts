/**
 * Money helpers — keep currency arithmetic free of binary floating-point drift.
 *
 * JavaScript numbers are IEEE-754 doubles, so `0.1 + 0.2 === 0.30000000000000004`.
 * Summing many dollar amounts directly accumulates these errors and produces
 * values like `123.45000000000002`, which then surface as wrong totals or
 * one-cent discrepancies in the budget. Working in integer **cents** and
 * converting back to dollars exactly once keeps results exact to the cent.
 */

/**
 * Round a dollar amount to the nearest cent.
 *
 * Rounds magnitude-symmetrically (so -1.005 → -1.01, mirroring 1.005 → 1.01)
 * and nudges by EPSILON to defend against values like 1.005 that float
 * representation would otherwise round *down*.
 *
 * Normalizes the result so a zero is always positive zero — `Math.sign(-0.001)`
 * is -1, which would otherwise produce `-0` for sub-half-cent negatives.
 */
export const roundMoney = (amount: number): number => {
  const result = (Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100)) / 100;
  // `-0 === 0` is true, so this collapses negative zero to positive zero.
  return result === 0 ? 0 : result;
};

/**
 * Sum dollar amounts exactly by accumulating in integer cents.
 *
 * @example sumMoney([0.1, 0.2]) // 0.3 (not 0.30000000000000004)
 */
export const sumMoney = (amounts: number[]): number =>
  amounts.reduce((cents, amount) => cents + Math.round(amount * 100), 0) / 100;

/** Add dollar amounts exactly (`a + b + ...`). */
export const addMoney = (...amounts: number[]): number => sumMoney(amounts);

/** Subtract `b` from `a` exactly. */
export const subtractMoney = (a: number, b: number): number =>
  (Math.round(a * 100) - Math.round(b * 100)) / 100;
