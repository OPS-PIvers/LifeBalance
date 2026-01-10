/**
 * String normalization utilities for data comparison and cleaning
 */

/**
 * Normalizes a string value by trimming whitespace and treating
 * undefined/null/empty strings as equivalent empty strings.
 * Useful for comparing values where undefined, null, and "" should be
 * considered equal (e.g., when checking if a field has actually changed).
 *
 * @param val - The value to normalize
 * @returns Normalized string (empty string if input is null/undefined)
 *
 * @example
 * normalizeValue(undefined) // ""
 * normalizeValue(null) // ""
 * normalizeValue("  hello  ") // "hello"
 * normalizeValue("") // ""
 */
export const normalizeValue = (val: string | undefined | null): string => {
  return val?.trim() ?? '';
};
