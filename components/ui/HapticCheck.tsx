import React from 'react';
import { cn } from '@/utils/cn';
import { hapticForNativeSwitch, markAsWebKitSwitch, type HapticPattern } from '@/utils/haptics';

interface HapticCheckProps {
  checked: boolean;
  /** Called with the requested next state when the user toggles the control. */
  onCheckedChange: (checked: boolean) => void;
  /**
   * Accessible name for the input. Optional because a text-bearing `children`
   * already labels the input through the wrapping <label>.
   */
  'aria-label'?: string;
  /** Styles the <label> (layout, tap target, `group-hover` scope). */
  className?: string;
  /** Android vibrate pattern (iOS ticks natively). Default 'light'. */
  pattern?: HapticPattern;
  /** Escape hatch for call sites that must e.g. stopPropagation the click. */
  onClick?: React.MouseEventHandler<HTMLLabelElement>;
  /** When true, the control is non-interactive (input disabled, no toggle). */
  disabled?: boolean;
  /** The visual: rendered after the visually-hidden input, inside the label. */
  children: React.ReactNode;
}

/**
 * A checkbox-shaped control that gets FREE native iOS haptics.
 *
 * iOS has no Vibration API, and since iOS 26.5 the programmatic switch-click
 * trick in utils/haptics.ts no longer fires. What still produces the system
 * haptic tick — on every iOS since 17.4 — is the user directly toggling a real
 * `<input type="checkbox" switch>`. So instead of a <button> with an onClick
 * haptic, check-style toggles render as a <label> wrapping a visually-hidden
 * switch-flavored checkbox plus a custom visual: the user's tap toggles the
 * real input, iOS fires its own tick, and Android gets a Vibration API pulse
 * from the onChange handler.
 *
 * The label carries the `group` class so call-site visuals keep their
 * `group-hover:` styling; the input carries `peer` for sibling styling. The
 * keyboard focus ring is drawn on the label via `has-[:focus-visible]`, since
 * the focusable input itself is sr-only.
 */
export const HapticCheck: React.FC<HapticCheckProps> = ({
  checked,
  onCheckedChange,
  'aria-label': ariaLabel,
  className,
  pattern = 'light',
  onClick,
  disabled = false,
  children,
}) => (
  <label
    onClick={onClick}
    className={cn(
      'group rounded-sm',
      disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500/40',
      className
    )}
  >
    <input
      type="checkbox"
      ref={markAsWebKitSwitch}
      className="sr-only peer"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        hapticForNativeSwitch(pattern);
        onCheckedChange(e.target.checked);
      }}
    />
    {children}
  </label>
);

export default HapticCheck;
