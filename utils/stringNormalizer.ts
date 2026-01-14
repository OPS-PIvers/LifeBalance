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

/**
 * Normalizes a string for use as a comparison key.
 * Trims whitespace and converts to lowercase.
 * Useful for case-insensitive matching (e.g., checking for duplicates).
 *
 * @param val - The value to normalize
 * @returns Normalized lowercase string (empty string if input is null/undefined)
 *
 * @example
 * normalizeToKey("  Hello  ") // "hello"
 * normalizeToKey(null) // ""
 */
export const normalizeToKey = (val: string | undefined | null): string => {
  return (val ?? '').trim().toLowerCase();
};
