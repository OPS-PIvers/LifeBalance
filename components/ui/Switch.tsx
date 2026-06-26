import React, { useId } from 'react';
import { cn } from '@/utils/cn';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onCheckedChange,
  disabled = false,
  className,
  id,
  'aria-label': ariaLabel,
}) => {
  // Fall back to a generated id so the <label htmlFor> always associates with
  // the input, even when no explicit id is passed by the call site.
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "relative inline-flex items-center shrink-0",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
    >
      <input
        type="checkbox"
        id={inputId}
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => !disabled && onCheckedChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className={cn(
        "w-11 h-6 rounded-full peer transition-colors duration-(--duration-base) ease-(--ease-standard)",
        "bg-brand-300 dark:bg-brand-700 peer-focus-visible:outline-hidden peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40",
        "peer-checked:bg-accent-600 dark:peer-checked:bg-accent-500",
        // Knob styles
        "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
        "after:bg-white after:border-brand-300 after:border after:rounded-full",
        "after:h-5 after:w-5 after:transition-all after:duration-(--duration-base)",
        // Knob checked state
        "peer-checked:after:translate-x-full peer-checked:after:border-white"
      )}></div>
    </label>
  );
};

export default Switch;
