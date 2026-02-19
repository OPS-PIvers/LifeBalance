import React from 'react';

interface ProgressBarProps {
  /** Current value of the progress (0 to max) */
  value: number;
  /** Maximum value (default: 100) */
  max?: number;
  /** Height of the progress bar */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Color variant of the progress bar */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'gradient' | 'custom';
  /** Custom color class (e.g. "bg-blue-500"). Use with variant="custom" or override variant. */
  colorClass?: string;
  /** Custom track color class (default: "bg-slate-100") */
  trackColorClass?: string;
  /** Additional classes for the container */
  className?: string;
  /** Aria label for accessibility */
  ariaLabel?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  size = 'md',
  variant = 'default',
  colorClass,
  trackColorClass = 'bg-slate-100',
  className = '',
  ariaLabel,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  const sizeClasses = {
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
    gradient: 'bg-gradient-to-r from-habit-gold to-orange-400',
    custom: '',
  };

  const barColor = colorClass || variantClasses[variant];

  return (
    <div
      className={`w-full rounded-full overflow-hidden ${sizeClasses[size]} ${trackColorClass} ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
};

export default ProgressBar;
