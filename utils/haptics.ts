/**
 * Lightweight haptic feedback helper.
 *
 * Wraps the Vibration API (navigator.vibrate) which is supported on most
 * Android browsers. iOS Safari does not support it, so calls are silently
 * ignored there — feature-detected and never throws.
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

/**
 * Trigger a haptic pulse. No-op when unsupported or when the user prefers
 * reduced motion (haptics are a form of motion feedback).
 */
export function haptic(pattern: HapticPattern = 'light'): void {
  if (!canVibrate()) return;

  // Respect reduced-motion preference for tactile feedback too.
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
}
