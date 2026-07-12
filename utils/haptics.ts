/**
 * Lightweight haptic feedback helper.
 *
 * Two transports, feature-detected and never throwing:
 *
 * 1. Vibration API (navigator.vibrate) — most Android browsers. Supports the
 *    richer multi-pulse patterns below. Suppressed under
 *    prefers-reduced-motion (vibration is literal motion).
 * 2. iOS Safari/PWA fallback — iOS has NO Vibration API, but since Safari
 *    17.4 clicking a `<label>` that toggles an `<input type="checkbox"
 *    switch>` fires the system "switch" haptic tick. A throwaway hidden
 *    label+switch is created, clicked, and removed per call — WebKit is picky
 *    here, and this exact shape (display:none, fresh element, synchronous
 *    remove) is the field-proven one; a cached off-screen element does NOT
 *    reliably fire. The tick is fixed-intensity, so "big" patterns are
 *    approximated with a second tick. Only works while handling a user
 *    gesture (tap handlers — exactly where the app calls haptic()); no-op
 *    before iOS 17.4. NOT gated on prefers-reduced-motion: iOS users control
 *    haptics via Settings → Sounds & Haptics (System Haptics), which this
 *    transport already respects natively, and Reduce Motion is an animation
 *    preference — tying the two together just silences haptics for users who
 *    never asked for that.
 *
 * Patterns are intentionally short and subtle: this is tactile punctuation
 * for meaningful moments (completing a habit, hitting a streak milestone),
 * not a constant buzz.
 */

export type HapticPattern = 'light' | 'medium' | 'success' | 'warning' | 'error';

// Vibration durations (ms). Arrays alternate vibrate/pause for richer patterns.
const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 20,
  success: [12, 40, 12],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

// Patterns that get a second tick on the fixed-intensity iOS transport.
const IOS_DOUBLE_TICK: ReadonlySet<HapticPattern> = new Set(['success', 'warning', 'error']);

const canVibrate = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// iPhone/iPad detection. Modern iPadOS masquerades as "MacIntel", so also
// treat a Mac platform with real touch points as iPad.
const isIosLike = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** One iOS system haptic tick via a throwaway hidden checkbox-switch toggle. */
const iosSwitchTick = (): void => {
  if (typeof document === 'undefined' || !document.head) return;
  try {
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    // Non-standard WebKit attribute that renders the checkbox as a switch —
    // the switch toggle is what produces the system haptic on iOS 17.4+.
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    document.head.removeChild(label);
  } catch {
    // Never let feedback affordances throw.
  }
};

/**
 * Trigger a haptic pulse. No-op when unsupported; the Android/vibrate path is
 * also suppressed when the user prefers reduced motion (see header comment
 * for why the iOS path is not).
 */
export function haptic(pattern: HapticPattern = 'light'): void {
  if (canVibrate()) {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      // Some browsers throw if called without a user gesture — ignore.
    }
    return;
  }

  if (isIosLike()) {
    iosSwitchTick();
    // Transient user activation survives ~a few seconds, so a short-delayed
    // second tick still fires — enough to distinguish "big" moments.
    if (IOS_DOUBLE_TICK.has(pattern) && typeof window !== 'undefined') {
      window.setTimeout(iosSwitchTick, 120);
    }
  }
}
