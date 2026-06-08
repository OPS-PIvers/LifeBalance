import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'dashed' | 'subtle' | 'ghost-danger' | 'success' | 'warning' | 'destructive' | 'ghost-destructive' | 'link' | 'ghost-inverted' | 'ghost-brand';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
  layout?: 'horizontal' | 'vertical';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', layout = 'horizontal', isLoading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-btn-primary hover:shadow-btn-primary-hover dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
      secondary: 'bg-white text-slate-700 border border-slate-200/60 hover:bg-slate-50 hover:text-slate-900 shadow-btn-secondary dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
      danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 shadow-sm dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30 dark:hover:bg-red-500/25',
      outline: 'bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:text-slate-100',
      dashed: 'bg-transparent border border-dashed border-slate-300 text-slate-500 font-semibold hover:bg-slate-50 hover:border-slate-400 hover:text-slate-600 shadow-none dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700/50 dark:hover:border-slate-500 dark:hover:text-slate-300',
      subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-transparent hover:border-brand-200/50 dark:bg-brand-700/40 dark:text-brand-100 dark:hover:bg-brand-700/60 dark:hover:border-brand-500/40',
      'ghost-danger': 'bg-transparent text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-500/15',
      'ghost-destructive': 'bg-transparent text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-300 dark:hover:bg-rose-500/15',
      'ghost-brand': 'bg-transparent text-brand-300 hover:text-brand-600 active:text-brand-800 active:bg-brand-50 dark:text-brand-400 dark:hover:text-brand-200 dark:active:text-brand-100 dark:active:bg-brand-700/40',
      success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-btn-success',
      warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-btn-warning',
      destructive: 'bg-rose-500 text-white hover:bg-rose-600 shadow-btn-destructive',
      link: 'bg-transparent text-brand-600 hover:text-brand-800 hover:underline px-0 shadow-none h-auto dark:text-brand-400 dark:hover:text-brand-200',
      'ghost-inverted': 'bg-transparent text-white/80 hover:text-white hover:bg-white/10',
    };

    const sizes = {
      sm: 'px-3 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
      icon: 'p-2',
      'icon-sm': 'p-1.5',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 rounded-2xl font-semibold tracking-tight transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20 focus-visible:ring-offset-2',
          layout === 'vertical' && 'flex-col gap-0.5',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={isLoading || disabled}
        aria-busy={isLoading}
        {...props}
      >
        {isLoading && (
          <>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading…</span>
          </>
        )}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
