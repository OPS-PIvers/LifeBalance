import React, { useId } from 'react';
import { cn } from '@/utils/cn';
import { hapticForNativeSwitch, markAsWebKitSwitch } from '@/utils/haptics';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Checked-track color. 'accent' (default, evergreen) or 'warm' (amber — gamification surfaces). */
  tone?: 'accent' | 'warm';
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

const SWITCH_TONES = {
  accent: {
    on: 'peer-checked:bg-accent-600 dark:peer-checked:bg-accent-500',
    ring: 'peer-focus-visible:ring-accent-500/40',
  },
  warm: {
    on: 'peer-checked:bg-warm-500 dark:peer-checked:bg-warm-500',
    ring: 'peer-focus-visible:ring-warm-500/40',
  },
} as const;

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  id,
  tone = 'accent',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
  'aria-describedby': ariaDescribedby,
}) => {
  // Fall back to a generated id so the <label htmlFor> always associates with
  // the input, even when no explicit id is passed by the call site.
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center self-center",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
    >
      <input
        type="checkbox"
        id={inputId}
        ref={markAsWebKitSwitch}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-describedby={ariaDescribedby}
        checked={checked}
        onChange={(e) => {
          if (disabled) return;
          hapticForNativeSwitch('light');
          onCheckedChange(e.target.checked);
        }}
        disabled={disabled}
        className="sr-only peer"
      />
      <div
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 rounded-full transition-colors duration-(--duration-base) ease-(--ease-standard)",
          "bg-brand-300 dark:bg-brand-700",
          "peer-focus-visible:outline-hidden peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-brand-900",
          SWITCH_TONES[tone].ring,
          SWITCH_TONES[tone].on,
          // Knob styles
          "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
          "after:h-5 after:w-5 after:rounded-full after:border after:border-brand-300 dark:after:border-brand-600 after:bg-white",
          "after:transition-[transform,border-color] after:duration-(--duration-base) after:ease-(--ease-standard)",
          // Knob checked state
          "peer-checked:after:translate-x-full peer-checked:after:border-white"
        )}
      ></div>
    </label>
  );
};

export default Switch;
