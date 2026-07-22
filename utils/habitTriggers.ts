/**
 * Habit Automations (PRD #1065) — shared trigger definitions, attribution, and
 * per-trigger dedup rules.
 *
 * One conceptual system with three automated trigger types plus manual taps.
 * Every automated fire behaves like one manual tap (same scoring/streak) and is
 * ATTRIBUTED visibly ("via to-do: …" / "via location: …" / "via transaction: …")
 * and DEDUPLICATED per its own rule:
 *   - to-do:        once per to-do                    (a to-do can only be completed once)
 *   - transaction:  once per (transaction, habit)      (re-editing a txn can't double-log
 *                   the SAME habit, but one transaction may legitimately fire several
 *                   different habits, each at most once)
 *   - geo:          once per day per location
 *   - manual:       never deduped (and cross-trigger double-fires stay allowed)
 *
 * Pure functions / constants only — no Firestore, no clock, no side effects.
 * Later PRs (to-do link, transaction chips, geo prompt) import these so the
 * attribution and dedup semantics live in exactly one place.
 */

export type TriggerType = 'todo' | 'geo' | 'transaction' | 'manual';

/** Static, display-facing metadata for each trigger type. */
export interface TriggerTypeDefinition {
  type: TriggerType;
  /** Human label for the automations UI (e.g. section rows). */
  label: string;
  /** Preposition phrase used to build the attribution string. */
  attributionPrefix: string | null;
}

export const TRIGGER_DEFINITIONS: Record<TriggerType, TriggerTypeDefinition> = {
  todo: { type: 'todo', label: 'Linked to-do', attributionPrefix: 'via to-do' },
  geo: { type: 'geo', label: 'Location', attributionPrefix: 'via location' },
  transaction: {
    type: 'transaction',
    label: 'Transaction keyword',
    attributionPrefix: 'via transaction',
  },
  manual: { type: 'manual', label: 'Manual', attributionPrefix: null },
};

/** The three automated (non-manual) trigger types, for iteration in the UI. */
export const AUTOMATED_TRIGGER_TYPES: readonly TriggerType[] = [
  'todo',
  'geo',
  'transaction',
];

/**
 * A concrete fire source. The `label` is the human-readable name of the thing
 * that fired the habit (the to-do text, the location name, the merchant/title).
 */
export type TriggerSource =
  | { type: 'todo'; todoId: string; label: string }
  | { type: 'geo'; locationId: string; label: string }
  | { type: 'transaction'; transactionId: string; habitId: string; label: string }
  | { type: 'manual' };

/**
 * Human attribution string for the toast and activity log, e.g.
 * "via to-do: Mow the lawn". Returns null for manual fires (no attribution).
 */
export function attributionString(source: TriggerSource): string | null {
  if (source.type === 'manual') return null;
  const prefix = TRIGGER_DEFINITIONS[source.type].attributionPrefix;
  if (!prefix) return null;
  return `${prefix}: ${source.label}`;
}

/**
 * The dedup key for a fire source, or null when the source is never deduped
 * (manual). `date` is a local `yyyy-MM-dd` string, only consulted for geo
 * (once/day/location); to-do and transaction dedup are date-independent.
 */
export function triggerDedupKey(source: TriggerSource, date: string): string | null {
  switch (source.type) {
    case 'todo':
      return `todo:${source.todoId}`;
    case 'transaction':
      return `txn:${source.transactionId}:${source.habitId}`;
    case 'geo':
      return `geo:${source.locationId}:${date}`;
    case 'manual':
      return null;
  }
}

/**
 * Should this trigger fire, given the keys already recorded as fired? Manual
 * fires always fire; an automated fire is suppressed only when its own dedup
 * key is already present. Cross-trigger double-fires are allowed by design
 * (different types produce different keys).
 */
export function shouldFireTrigger(
  source: TriggerSource,
  date: string,
  firedKeys: readonly string[],
): boolean {
  const key = triggerDedupKey(source, date);
  if (key === null) return true;
  return !firedKeys.includes(key);
}
