import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'dashed' | 'subtle' | 'muted' | 'ghost-danger' | 'success' | 'warning' | 'destructive' | 'ghost-destructive' | 'link' | 'ghost-inverted';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-brand-800 text-white hover:bg-brand-900 shadow-[0_1px_2px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.1)]',
      secondary: 'bg-white text-slate-700 border border-slate-200/60 hover:bg-slate-50 hover:text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.05)]',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100/50 hover:text-slate-900',
      danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 shadow-sm',
      outline: 'bg-transparent border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900',
      dashed: 'bg-transparent border border-dashed border-slate-300 text-slate-500 font-semibold hover:bg-slate-50 hover:border-slate-400 hover:text-slate-600 shadow-none',
      subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-transparent hover:border-brand-200/50',
      muted: 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600',
      'ghost-danger': 'bg-transparent text-rose-500 hover:text-rose-600 hover:bg-rose-50',
      'ghost-destructive': 'bg-transparent text-slate-400 hover:text-rose-600 hover:bg-rose-50',
      success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-[0_1px_2px_rgba(16,185,129,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]',
      warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-[0_1px_2px_rgba(245,158,11,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]',
      destructive: 'bg-rose-500 text-white hover:bg-rose-600 shadow-[0_1px_2px_rgba(244,63,94,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]',
      link: 'bg-transparent text-brand-600 hover:text-brand-800 hover:underline px-0 shadow-none h-auto',
      'ghost-inverted': 'bg-transparent text-white/80 hover:text-white hover:bg-white/10',
    };

    const sizes = {
      sm: 'px-3 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
      icon: 'p-2',
      'icon-sm': 'p-1',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 rounded-xl font-semibold tracking-tight transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/20 focus-visible:ring-offset-2',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={isLoading || disabled}
        {...props}
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
