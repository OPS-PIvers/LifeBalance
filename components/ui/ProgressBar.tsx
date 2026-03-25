import React from 'react';
import { cn } from '../../utils/cn';

interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number; // The current value of the progress bar.
  max?: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'custom';
  colorClass?: string;
  barClassName?: string;
  trackClassName?: string;
  showAnimation?: boolean; // Defaults to true
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  colorClass,
  barClassName,
  trackClassName,
  className,
  showAnimation = true,
  ...props
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizes = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3',
    xl: 'h-4',
  };

  const variantClasses = {
    default: 'bg-brand-500',
    success: 'bg-money-pos',
    warning: 'bg-habit-gold',
    danger: 'bg-money-neg',
    custom: colorClass || '',
  };

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn(
        'w-full bg-slate-100 rounded-full overflow-hidden',
        sizes[size],
        className,
        trackClassName
      )}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full',
          showAnimation && 'transition-all duration-500',
          variantClasses[variant],
          barClassName
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};
