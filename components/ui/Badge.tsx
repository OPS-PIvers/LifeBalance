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
    default: 'bg-brand-100 text-brand-800',
    neutral: 'bg-slate-100 text-slate-800',
    brand: 'bg-brand-100 text-brand-700',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    outline: 'bg-transparent border border-slate-200 text-slate-600',
  };

  const sizes = {
    sm: 'text-xxs px-1.5 py-0.5',
    md: 'text-xs px-2.5 py-0.5',
  };

  return (
    <span className={cn('inline-flex items-center justify-center font-bold rounded-full whitespace-nowrap', variants[variant], sizes[size], className)}>
      {children}
    </span>
  );
};
