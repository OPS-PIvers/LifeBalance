import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Canonical intent → variant map. Reach for ONE variant per intent; don't add
 * new ones. The danger family is ordered by emphasis — pick the quietest that
 * still reads as destructive.
 *
 *  Affirmative / primary
 *   - primary      Main page/dialog action (filled evergreen).
 *   - secondary    Secondary action beside a primary (bordered, on-surface).
 *   - subtle       Low-emphasis affirmative (tinted accent, e.g. inline "Add").
 *   - success      Confirm/positive-money action (solid green). Use sparingly.
 *
 *  Low-emphasis / neutral
 *   - ghost        Neutral icon/text button (transparent, brand text).
 *   - ghost-brand  Neutral that warms to accent on hover/active.
 *   - outline      Bordered neutral on the page background.
 *   - dashed       "Add something here" affordance (dashed border).
 *   - link         Inline text link (no padding/box).
 *   - ghost-inverted  Ghost on a dark/hero surface (white text).
 *
 *  Destructive — loudest → quietest
 *   - destructive       Solid red. Highest emphasis (e.g. final "Delete account").
 *   - danger            Red tint + border. Medium (e.g. Delete in a confirm).
 *   - ghost-danger      Transparent, always-red text (inline "Remove").
 *   - ghost-destructive Neutral text that turns red on hover (a row's trash icon).
 *
 *  Caution
 *   - warning      Solid amber, for caution actions. Rare.
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'dashed'| 'subtle' | 'ghost-danger' | 'success' | 'warning' | 'destructive' | 'ghost-destructive' | 'link' | 'ghost-inverted' | 'ghost-brand';
  size?: 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';
  layout?: 'horizontal' | 'vertical';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', layout = 'horizontal', isLoading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const variants = {
      primary: 'bg-accent-600 text-white hover:bg-accent-700 shadow-btn-primary hover:shadow-btn-primary-hover dark:bg-accent-500 dark:text-white dark:hover:bg-accent-400',
      secondary: 'bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 hover:text-brand-900 shadow-btn-secondary dark:bg-brand-800 dark:text-brand-200 dark:border-brand-700 dark:hover:bg-brand-700/60 dark:hover:text-brand-100',
      ghost: 'bg-transparent text-brand-600 hover:bg-brand-100 hover:text-brand-900 dark:text-brand-400 dark:hover:bg-brand-700/50 dark:hover:text-brand-100',
      danger: 'bg-money-bgNeg text-money-neg border border-money-neg/30 hover:bg-money-neg/10 dark:bg-money-neg/15 dark:text-money-negDark dark:border-money-neg/40 dark:hover:bg-money-neg/25',
      outline: 'bg-transparent border border-brand-200 text-brand-600 hover:bg-brand-50 hover:text-brand-900 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-700/50 dark:hover:text-brand-100',
      dashed: 'bg-transparent border border-dashed border-brand-300 text-brand-500 font-semibold hover:bg-brand-50 hover:border-brand-400 hover:text-brand-600 shadow-none dark:border-brand-600 dark:text-brand-400 dark:hover:bg-brand-700/50 dark:hover:border-brand-500 dark:hover:text-brand-300',
      subtle: 'bg-accent-50 text-accent-700 hover:bg-accent-100 border border-transparent hover:border-accent-200 dark:bg-accent-800/50 dark:text-accent-100 dark:hover:bg-accent-800/70 dark:hover:border-accent-700',
      'ghost-danger': 'bg-transparent text-money-neg hover:text-money-neg hover:bg-money-bgNeg dark:text-money-negDark dark:hover:text-money-negDark dark:hover:bg-money-neg/15',
      'ghost-destructive': 'bg-transparent text-brand-400 hover:text-money-neg hover:bg-money-bgNeg dark:text-brand-450 dark:hover:text-money-negDark dark:hover:bg-money-neg/15',
      'ghost-brand': 'bg-transparent text-brand-400 hover:text-accent-600 active:text-accent-800 active:bg-accent-50 dark:text-brand-400 dark:hover:text-accent-300 dark:active:text-accent-200 dark:active:bg-accent-800/40',
      success: 'bg-money-pos text-white hover:brightness-95 shadow-btn-primary',
      warning: 'bg-warm-600 text-white hover:bg-warm-700 shadow-btn-primary',
      destructive: 'bg-money-neg text-white hover:brightness-95 shadow-btn-primary',
      link: 'bg-transparent text-accent-600 hover:text-accent-700 hover:underline px-0 shadow-none h-auto dark:text-accent-300 dark:hover:text-accent-200',
      'ghost-inverted': 'bg-transparent text-white/80 hover:text-white hover:bg-white/10',
    };

    // sm/md/icon-sm render below the 44px touch-target floor, so they carry an
    // invisible before: pseudo-element that extends the hit area (vertically
    // only for text buttons — horizontal rows of small buttons would otherwise
    // overlap zones) without changing the visual size. The base classes below
    // include `relative`, which the pseudo anchors to.
    const sizes = {
      sm: "px-3 py-1 text-xs before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-['']",
      md: "px-4 py-2 text-sm before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
      lg: 'px-6 py-3 text-base',
      icon: 'p-2 min-w-11 min-h-11',
      'icon-sm': "p-1.5 min-w-9 min-h-9 before:absolute before:-inset-1 before:content-['']",
    };

    return (
      <button
        ref={ref}
        className={cn(
          'relative inline-flex items-center justify-center gap-2 rounded-btn font-semibold tracking-tight transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900',
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
