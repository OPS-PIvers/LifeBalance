import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'subtle' | 'ghost-danger' | 'success' | 'warning' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-brand-800 text-white hover:bg-brand-900 shadow-sm',
      secondary: 'bg-white text-brand-600 border border-brand-200 hover:bg-brand-50 shadow-sm',
      ghost: 'bg-transparent text-brand-600 hover:bg-brand-100',
      danger: 'bg-red-50 text-red-700 border-2 border-red-200 hover:bg-red-100',
      outline: 'bg-transparent border-2 border-brand-200 text-brand-600 hover:bg-brand-50',
      subtle: 'bg-brand-100 text-brand-700 hover:bg-brand-200',
      'ghost-danger': 'bg-transparent text-red-400 hover:text-red-600 hover:bg-red-50',
      success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm',
      warning: 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm',
      destructive: 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm',
    };

    const sizes = {
      sm: 'px-3 py-1 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base',
      icon: 'p-2'
    };

    return (
      <button
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
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
