import React from 'react';
import { cn } from '../../utils/cn';

interface ProgressBarProps {
  /** The current value of the progress bar */
  value: number;
  /** The maximum value (default: 100) */
  max?: number;
  /** size of the progress bar */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** Classes for the filled part (indicator) */
  colorClass?: string;
  /** Classes for the track (background) */
  trackColorClass?: string;
  /** Whether to animate the width change (default: true) */
  showAnimation?: boolean;
  /** Additional classes for the container */
  className?: string;
  /** Accessibility label */
  'aria-label'?: string;
}

const sizeClasses = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
  xl: 'h-4',
};

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  colorClass,
  trackColorClass = 'bg-slate-100',
  showAnimation = true,
  className,
  'aria-label': ariaLabel,
}) => {
  const percent = Math.min(100, Math.max(0, (value / max) * 100));

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
          colorClass,
          showAnimation && 'transition-all duration-500'
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
};
