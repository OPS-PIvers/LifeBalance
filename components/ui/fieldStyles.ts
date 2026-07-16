/**
 * Shared visual recipe for text-entry form controls (Input, Textarea, Select).
 * Single source of truth so every field renders the same surface, border,
 * focus ring, and disabled treatment.
 *
 * Focus model: text fields keep `focus:` (not `focus-visible:`) so the accent
 * ring shows whenever the field is active — on mouse click and keyboard alike,
 * the conventional cue for the focused field. (Buttons use `focus-visible:` so
 * a ring doesn't linger after a mouse click.) Ring opacity is unified at /40 to
 * match the rest of the system.
 */
export const FIELD_BASE =
  'w-full p-3 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-btn outline-hidden text-brand-900 dark:text-brand-100 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/40 transition-all duration-(--duration-fast) ease-(--ease-standard) placeholder:text-brand-400 dark:placeholder:text-brand-450 disabled:opacity-50 disabled:bg-brand-50 dark:disabled:bg-brand-700/50';

/** Error-state overrides, layered on top of FIELD_BASE when a field is invalid. */
export const FIELD_ERROR =
  'border-money-neg focus:border-money-neg focus:ring-money-neg/40';
