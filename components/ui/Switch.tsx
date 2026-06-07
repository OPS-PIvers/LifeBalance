import React from 'react';
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
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-flex items-center flex-shrink-0",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
    >
      <input
        type="checkbox"
        id={id}
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => !disabled && onCheckedChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className={cn(
        "w-11 h-6 rounded-full peer transition-colors duration-200 ease-in-out",
        "bg-brand-200 dark:bg-slate-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-brand-300 dark:peer-focus:ring-brand-500/30",
        "peer-checked:bg-brand-600 dark:peer-checked:bg-brand-500",
        // Knob styles
        "after:content-[''] after:absolute after:top-[2px] after:left-[2px]",
        "after:bg-white after:border-gray-300 after:border after:rounded-full",
        "after:h-5 after:w-5 after:transition-all after:duration-200",
        // Knob checked state
        "peer-checked:after:translate-x-full peer-checked:after:border-white"
      )}></div>
    </label>
  );
};

export default Switch;
