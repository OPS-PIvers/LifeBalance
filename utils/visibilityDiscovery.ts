/**
 * One-time "What I see" discovery nudge (2F.3). Members have no other way to
 * find the per-member visibility editor (Settings → Modules → "What I see",
 * shipped in 2F.1) — it lives inside a Settings sub-screen they'd have no
 * reason to open otherwise. `VisibilityDiscoveryCard` (Dashboard) surfaces it
 * once and is dismissible; the flag lives here (not in the component file, so
 * `OnboardingWizard` can share it) following the same try/catch localStorage
 * idiom as `utils/firstTimeFlags.ts` and the `WeeklyRecapCard`/
 * `SetupChecklistCard` dismiss helpers.
 *
 * Scoped per member `uid` (not per household) — a shared device shows the
 * nudge once per account, not once ever regardless of who's signed in.
 *
 * The first-run onboarding wizard's own "What I see" step covers this exact
 * ground for a brand-new household creator, so `OnboardingWizard` marks this
 * SAME flag on completing (or skipping) the wizard — a member who just saw
 * the feature there doesn't also get nagged by the card moments later.
 */

const dismissKey = (uid: string): string => `lb_visibility_discovery_dismissed_${uid}`;

/** Whether this member has already dismissed the nudge (or completed onboarding, which counts). */
export function isVisibilityDiscoveryDismissed(uid: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(uid)) === '1';
  } catch {
    // Storage unavailable (private browsing, quota) — never claim "dismissed"
    // when we can't actually persist it, so the nudge stays available.
    return false;
  }
}

/** Persist the dismissal so the nudge never reappears for this member on this device. */
export function dismissVisibilityDiscovery(uid: string): void {
  try {
    window.localStorage.setItem(dismissKey(uid), '1');
  } catch {
    // Best-effort — in-session component state still hides the card for this visit.
  }
}
