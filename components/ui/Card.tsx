import React, { HTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Add a hover/press affordance for cards that act as a button or link. */
  interactive?: boolean;
}

const Card: React.FC<CardProps> = ({
  className,
  children,
  interactive = false,
  onKeyDown,
  ...props
}) => {
  // When the card itself is the clickable element, give it button semantics:
  // focusable, Enter/Space activates it (via a real click so onClick fires with
  // a proper event — no type casts), and a visible focus ring.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.currentTarget.click();
    }
    onKeyDown?.(e);
  };

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? handleKeyDown : onKeyDown}
      className={cn(
        'bg-white dark:bg-brand-800 rounded-card border border-brand-200 dark:border-brand-700',
        interactive &&
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.98] cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
