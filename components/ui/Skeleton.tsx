import React from 'react';
import { cn } from '@/utils/cn';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind shape helpers are passed via className (w-, h-, rounded-). */
  className?: string;
}

/**
 * Base shimmer placeholder used while data loads.
 *
 * Uses a moving gradient ("shimmer" keyframe in index.css) that automatically
 * falls back to a static tint when the user prefers reduced motion (handled in
 * CSS via the `.skeleton` class). Composable: set size/shape with Tailwind
 * utilities, e.g. <Skeleton className="h-4 w-32 rounded-md" />.
 */
export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => (
  <div
    role="presentation"
    aria-hidden="true"
    className={cn('skeleton rounded-md bg-slate-200/70 dark:bg-slate-700/50', className)}
    {...props}
  />
);

/** A run of text-line skeletons. The last line is shortened for realism. */
export const SkeletonText: React.FC<{ lines?: number; className?: string }> = ({
  lines = 3,
  className,
}) => (
  <div className={cn('space-y-2', className)}>
    {Array.from({ length: lines }).map((_, i) => (
      <Skeleton
        key={i}
        className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')}
      />
    ))}
  </div>
);

/**
 * Glass-card shaped skeleton matching the app's widget container
 * (bg-white/80 backdrop-blur rounded-3xl). Wrap arbitrary skeleton content.
 */
export const SkeletonCard: React.FC<{ className?: string; children?: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div
    className={cn(
      'bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6',
      className
    )}
  >
    {children ?? (
      <div className="space-y-4">
        <Skeleton className="h-4 w-1/3" />
        <SkeletonText lines={3} />
      </div>
    )}
  </div>
);
