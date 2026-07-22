/**
 * Server-side twin of utils/captureReview.ts — self-contained (no `@/` app
 * import) pure helpers for deciding whether a quick-add-API / iOS Shortcut
 * capture is added automatically or held for manual review, per household.
 *
 * KEEP IN SYNC with utils/captureReview.ts (types + DEFAULTS duplicated
 * deliberately, mirroring the client/server streakLogic.ts split — see
 * CLAUDE.md's Habit Tracking System section for the precedent).
 */

/** The quick-add-API / iOS Shortcut capture input types. */
export type CaptureType = "expense" | "shopping" | "todo";

/** 'auto' = added directly; 'review' = held for manual review. */
export type CaptureReviewMode = "auto" | "review";

/**
 * Legacy-preserving defaults: expense captures have always landed as
 * pending-review transactions awaiting categorization, while shopping/todo
 * captures have always been added directly. Only an explicit override in the
 * household's stored `captureReview` map changes a type's routing.
 */
const DEFAULTS: Record<CaptureType, CaptureReviewMode> = {
  expense: "review",
  shopping: "auto",
  todo: "auto",
};

/**
 * The effective capture-review mode for a given input type: an explicit
 * per-household override when set, else the legacy-preserving default.
 * `captureReview` is the raw `Household.captureReview` field value (or
 * undefined/null, e.g. household doc not yet loaded).
 */
export function getCaptureReviewMode(
  captureReview: Partial<Record<CaptureType, CaptureReviewMode>> | undefined | null,
  type: CaptureType,
): CaptureReviewMode {
  return captureReview?.[type] ?? DEFAULTS[type];
}

/** Whether a capture of this type should be held for manual review. */
export function isManualReview(
  captureReview: Partial<Record<CaptureType, CaptureReviewMode>> | undefined | null,
  type: CaptureType,
): boolean {
  return getCaptureReviewMode(captureReview, type) === "review";
}
