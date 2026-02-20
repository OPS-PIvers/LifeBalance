import React from 'react';
import { cn } from '../../utils/cn';

export interface ProgressBarProps {
  /** Current value (0 to 100) */
  value: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Height of the progress bar */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Color variant for the progress bar fill (overridden by colorClass) */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'brand';
  /** Custom class for the fill (e.g., specific color or gradient) */
  colorClass?: string;
  /** Custom class for the track background */
  trackColorClass?: string;
  /** Additional classes for the container */
  className?: string;
  /** Whether to show a label above the bar */
  showLabel?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  colorClass,
  trackColorClass,
  className,
  showLabel = false,
}) => {
  // Ensure percentage is between 0 and 100
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
    xl: 'h-4',
  };

  const variantClasses = {
    default: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
    brand: 'bg-brand-800',
  };

  // Determine fill color: custom class takes precedence over variant
  const fillColor = colorClass || variantClasses[variant];
  const trackColor = trackColorClass || 'bg-brand-100';

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="flex justify-between text-xs font-medium text-brand-600 mb-1">
          <span>{percentage.toFixed(0)}%</span>
        </div>
      )}
      <div
        className={cn(
          'w-full rounded-full overflow-hidden',
          sizeClasses[size],
          trackColor
        )}
        role="progressbar"
        aria-valuenow={Math.round(percentage)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            fillColor
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
