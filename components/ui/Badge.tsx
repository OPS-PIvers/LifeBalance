import React from 'react';
import { cn } from '@/utils/cn';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'md',
  className,
}) => {
  const variants = {
    default: 'bg-accent-50 text-accent-700 border border-accent-200 dark:bg-accent-800/40 dark:text-accent-200 dark:border-accent-700',
    neutral: 'bg-brand-100 text-brand-600 border border-brand-200 dark:bg-brand-700/50 dark:text-brand-300 dark:border-brand-700',
    brand: 'bg-accent-50 text-accent-700 border border-accent-200 dark:bg-accent-800/40 dark:text-accent-200 dark:border-accent-700',
    success: 'bg-money-bgPos text-money-pos border border-money-pos/30 dark:bg-money-pos/15 dark:text-money-posDark dark:border-money-pos/40',
    warning: 'bg-warm-50 text-warm-700 border border-warm-200 dark:bg-warm-900/40 dark:text-warm-200 dark:border-warm-700',
    danger: 'bg-money-bgNeg text-money-neg border border-money-neg/30 dark:bg-money-neg/15 dark:text-money-negDark dark:border-money-neg/40',
    outline: 'bg-transparent border border-brand-200 text-brand-600 dark:border-brand-700 dark:text-brand-400',
  };

  const sizes = {
    sm: 'text-xxs px-2 py-0.5',
    md: 'text-xs px-2.5 py-0.5',
  };

  return (
    <span className={cn('inline-flex items-center justify-center font-bold tracking-tight rounded-full whitespace-nowrap', variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
};
