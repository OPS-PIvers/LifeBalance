/**
 * Lightweight haptic feedback helper.
 *
 * Two transports, feature-detected and never throwing:
 *
 * 1. Vibration API (navigator.vibrate) — most Android browsers. Supports the
 *    richer multi-pulse patterns below. Suppressed under
 *    prefers-reduced-motion (vibration is literal motion).
 * 2. iOS Safari/PWA fallback — **iOS 17.4–26.4 only; Apple patched it in
 *    iOS 26.5.** iOS has no Vibration API, but on those versions clicking a
 *    `<label>` that toggles an `<input type="checkbox" switch>` fired the
 *    system "switch" haptic tick even for a programmatic click. A throwaway
 *    hidden label+switch is created, clicked, and removed per call — WebKit
 *    is picky here, and this exact shape (display:none, fresh element,
 *    synchronous remove) is the field-proven one; a cached off-screen element
 *    does NOT reliably fire. The tick is fixed-intensity, so "big" patterns
 *    are approximated with a second tick. Only works while handling a user
 *    gesture (tap handlers — exactly where the app calls haptic()); no-op
 *    before iOS 17.4. NOT gated on prefers-reduced-motion: iOS users control
 *    haptics via Settings → Sounds & Haptics (System Haptics), which this
 *    transport already respects natively, and Reduce Motion is an animation
 *    preference — tying the two together just silences haptics for users who
 *    never asked for that.
 *
 *    As of iOS 26.5 a programmatic label click no longer produces the tick —
 *    it was always an unintended side effect and WebKit closed it. The
 *    transport is kept as graceful degradation for 17.4–26.4; on 26.5+ it is
 *    a silent no-op. What DOES still fire the system haptic on 26.5+ is a
 *    real user tap on an actual `<input type="checkbox" switch>` control, so
 *    toggle-shaped UI should carry the switch attribute on its (real, even
 *    if visually hidden) checkbox input — see components/ui/Switch.tsx and
 *    components/ui/HapticCheck.tsx. Such controls must call
 *    hapticForNativeSwitch() (Android vibrate only) instead of haptic(), or
 *    they would double-tick on iOS 17.4–26.4.
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

/**
 * One iOS system haptic tick via a throwaway hidden checkbox-switch toggle.
 * Fires on iOS 17.4–26.4 only (patched in 26.5 — see header comment).
 */
const iosSwitchTick = (): void => {
  if (typeof document === 'undefined' || !document.head) return;
  try {
    const label = document.createElement('label');
    label.ariaHidden = 'true';
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    // Non-standard WebKit attribute that renders the checkbox as a switch —
    // the switch toggle is what produces the system haptic.
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
 * Vibration API path. Returns true when the environment supports
 * navigator.vibrate (whether or not the pulse was suppressed by
 * prefers-reduced-motion) so callers know not to try the iOS fallback.
 */
const tryVibrate = (pattern: HapticPattern): boolean => {
  if (!canVibrate()) return false;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return true;
  }
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw if called without a user gesture — ignore.
  }
  return true;
};

/**
 * Trigger a haptic pulse. No-op when unsupported; the Android/vibrate path is
 * also suppressed when the user prefers reduced motion (see header comment
 * for why the iOS path is not). Must be called synchronously inside a user
 * gesture handler — after an `await` (or inside a timer) the iOS transport
 * silently does nothing because transient user activation has expired.
 */
export function haptic(pattern: HapticPattern = 'light'): void {
  if (tryVibrate(pattern)) return;

  if (isIosLike()) {
    iosSwitchTick();
    // Transient user activation survives ~a few seconds, so a short-delayed
    // second tick still fires — enough to distinguish "big" moments.
    if (IOS_DOUBLE_TICK.has(pattern) && typeof window !== 'undefined') {
      window.setTimeout(iosSwitchTick, 120);
    }
  }
}

/**
 * Haptic for controls built on a real `<input type="checkbox" switch>`
 * (Switch, HapticCheck): Android gets a Vibration API pulse; iOS is left to
 * the system, which fires its own tick for the user's direct toggle of the
 * switch input — on ALL versions since 17.4, including 26.5+ where the
 * programmatic trick above no longer works. Calling plain haptic() from such
 * controls would double-tick on iOS 17.4–26.4.
 */
export function hapticForNativeSwitch(pattern: HapticPattern = 'light'): void {
  tryVibrate(pattern);
}

/**
 * Ref callback that marks a (usually visually-hidden) checkbox input as a
 * WebKit switch, so a user's direct tap fires the iOS system haptic tick —
 * including on iOS 26.5+ where the programmatic transport above is dead.
 * The attribute is non-standard and absent from React's types, hence a ref
 * callback rather than a JSX prop.
 */
export const markAsWebKitSwitch = (el: HTMLInputElement | null): void => {
  el?.setAttribute('switch', '');
};
