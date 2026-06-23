/**
 * Shared legal-consent metadata (Plan 011).
 *
 * `CONSENT_VERSION` is an ISO date string identifying the version of the
 * Terms of Service / Privacy Policy that a user agreed to at signup. Both the
 * signup UI and the household service import this constant so the value written
 * to Firestore (`HouseholdMember.consentVersion`) can never drift from what the
 * UI presented.
 *
 * Bump this whenever the legal copy changes materially: a newer value than what
 * a member previously accepted signals that a re-consent flow is needed.
 */
export const CONSENT_VERSION = '2026-06-23';
