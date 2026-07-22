import type { Household, CaptureType, CaptureReviewMode } from '@/types/schema';

/**
 * Per-household captureReview settings, mirroring how utils/moduleVisibility.ts
 * accepts the full Household, a `Pick`ed shape, or null/undefined (during cold
 * load).
 */
type CaptureSettings = Pick<Household, 'captureReview'> | null | undefined;

/**
 * Legacy-preserving defaults: expense captures have always landed as
 * `pending_review` transactions awaiting categorization, while shopping/todo
 * captures have always been added directly. Only an explicit override in
 * `Household.captureReview` changes a type's routing.
 *
 * KEEP IN SYNC with the server twin, functions/src/quickAdd/captureReview.ts
 * (defaults duplicated deliberately, like the streak-logic twin — see
 * CLAUDE.md's Habit Tracking System section).
 */
const DEFAULTS: Record<CaptureType, CaptureReviewMode> = {
  expense: 'review',
  shopping: 'auto',
  todo: 'auto',
};

/**
 * The effective capture-review mode for a given input type: an explicit
 * per-household override when set, else the legacy-preserving default.
 */
export function getCaptureReviewMode(settings: CaptureSettings, type: CaptureType): CaptureReviewMode {
  return settings?.captureReview?.[type] ?? DEFAULTS[type];
}

/** Whether a capture of this type should be held for manual review. */
export function isManualReview(settings: CaptureSettings, type: CaptureType): boolean {
  return getCaptureReviewMode(settings, type) === 'review';
}
