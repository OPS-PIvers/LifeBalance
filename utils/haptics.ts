/**
 * Lightweight haptic feedback helper.
 *
 * Two transports, feature-detected and never throwing:
 *
 * 1. Vibration API (navigator.vibrate) — most Android browsers. Supports the
 *    richer multi-pulse patterns below.
 * 2. iOS Safari/PWA fallback — iOS has NO Vibration API, but since Safari 17.4
 *    toggling an `<input type="checkbox" switch>` via a `<label>` click fires
 *    the system "switch" haptic tick. We keep one hidden switch in the DOM and
 *    click its label. Caveats: it produces a single fixed-intensity tick (no
 *    patterns), and it only works while handling a user gesture (tap handlers
 *    — which is exactly where the app calls haptic()); outside a gesture it
 *    silently does nothing. On iOS versions before 17.4 it's a full no-op.
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

const canVibrate = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// iPhone/iPad detection. Modern iPadOS masquerades as "MacIntel", so also
// treat a Mac platform with real touch points as iPad.
const isIosLike = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Lazily-created hidden `<label><input type="checkbox" switch></label>` used
// by the iOS fallback. Kept off-screen (not display:none — WebKit skips the
// haptic for non-rendered switches) and out of the a11y tree / tab order.
let iosSwitchLabel: HTMLLabelElement | null = null;

const getIosSwitchLabel = (): HTMLLabelElement | null => {
  if (typeof document === 'undefined' || !document.body) return null;
  if (iosSwitchLabel && document.body.contains(iosSwitchLabel)) return iosSwitchLabel;

  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:fixed;top:0;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';

  const input = document.createElement('input');
  input.type = 'checkbox';
  // Non-standard WebKit attribute that renders the checkbox as a switch —
  // the switch toggle is what produces the system haptic on iOS 17.4+.
  input.setAttribute('switch', '');
  input.tabIndex = -1;

  label.appendChild(input);
  document.body.appendChild(label);
  iosSwitchLabel = label;
  return label;
};

/**
 * Trigger a haptic pulse. No-op when unsupported or when the user prefers
 * reduced motion (haptics are a form of motion feedback).
 */
export function haptic(pattern: HapticPattern = 'light'): void {
  // Respect reduced-motion preference for tactile feedback too.
  if (
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return;
  }

  if (canVibrate()) {
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      // Some browsers throw if called without a user gesture — ignore.
    }
    return;
  }

  // iOS fallback: a single switch-toggle tick regardless of pattern (chained
  // ticks via setTimeout would fall outside the user-gesture window and be
  // ignored by WebKit anyway).
  if (isIosLike()) {
    try {
      getIosSwitchLabel()?.click();
    } catch {
      // Never let feedback affordances throw.
    }
  }
}
