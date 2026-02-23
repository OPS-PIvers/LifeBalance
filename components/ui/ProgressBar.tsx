import React from 'react';
import { cn } from '../../utils/cn';

export interface ProgressBarProps {
  /** Current value of the progress (0 to max) */
  value: number;
  /** Maximum value (default 100) */
  max?: number;
  /** Size of the progress bar */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Tailwind class for the filled part (e.g., 'bg-blue-500' or gradient) */
  colorClass?: string;
  /** Tailwind class for the track background (e.g., 'bg-slate-100') */
  trackColorClass?: string;
  /** Additional classes for the container */
  className?: string;
  /** Whether to animate the progress change */
  showAnimation?: boolean;
  /** Accessibility label */
  'aria-label'?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  colorClass,
  trackColorClass = 'bg-slate-100',
  className,
  showAnimation = true,
  'aria-label': ariaLabel,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
    xl: 'h-4',
  };

  return (
    <div
      className={cn(
        'w-full rounded-full overflow-hidden',
        sizeClasses[size],
        trackColorClass,
        className
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel}
    >
      <div
        className={cn(
          'h-full rounded-full',
          showAnimation && 'transition-all duration-500',
          colorClass || 'bg-brand-500'
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
