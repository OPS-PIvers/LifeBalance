import React from 'react';
import { cn } from '../../utils/cn';

interface ProgressBarProps {
  /** The current value of the progress bar */
  value: number;
  /** The maximum value (default 100) */
  max?: number;
  /** The size (height) of the progress bar */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** The visual variant */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'gradient' | 'custom';
  /** Custom class for the progress indicator (overrides variant color) */
  colorClass?: string;
  /** Custom class for the track background */
  trackColorClass?: string;
  /** Additional classes for the container */
  className?: string;
}

const SIZE_CLASSES = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
  xl: 'h-4',
};

const VARIANT_CLASSES = {
  default: 'bg-brand-500',
  success: 'bg-money-pos',
  warning: 'bg-habit-gold',
  danger: 'bg-money-neg',
  gradient: 'bg-gradient-to-r from-habit-gold to-orange-400',
  custom: '',
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  colorClass,
  trackColorClass = 'bg-slate-100',
  className,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      className={cn(
        SIZE_CLASSES[size],
        trackColorClass,
        'w-full rounded-full overflow-hidden',
        className
      )}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-500',
          variant !== 'custom' && VARIANT_CLASSES[variant],
          colorClass
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
