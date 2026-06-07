import React from 'react';
import { cn } from '../../utils/cn';

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
    default: 'bg-brand-50 text-brand-700 border border-brand-200/50 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30',
    neutral: 'bg-slate-50 text-slate-600 border border-slate-200/60 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-700',
    brand: 'bg-brand-50 text-brand-700 border border-brand-200/50 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30',
    success: 'bg-emerald-50 text-emerald-700 border border-emerald-200/50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
    warning: 'bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
    danger: 'bg-rose-50 text-rose-700 border border-rose-200/50 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30',
    outline: 'bg-transparent border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400',
  };

  const sizes = {
    sm: 'text-xxs px-2 py-0.5',
    md: 'text-xs px-2.5 py-0.5',
  };

  return (
    <span className={cn('inline-flex items-center justify-center font-bold tracking-tight rounded-full whitespace-nowrap shadow-sm', variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
};
