import React from 'react';
import { Skeleton, SkeletonText } from '../ui/Skeleton';

/**
 * Loading placeholder for the Dashboard. Mirrors the real layout (header +
 * stacked glass widget cards) so the page doesn't reflow when data arrives.
 */
export const DashboardSkeleton: React.FC = () => (
  <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-32" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading your dashboard…</span>

    {/* Header */}
    <div className="px-6 py-8 flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-12 w-12 rounded-2xl" />
    </div>

    <div className="px-4 space-y-8">
      {/* Action Queue card */}
      <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-premium ring-1 ring-black/5 rounded-3xl p-8">
        <Skeleton className="h-4 w-32 mb-6" />
        <div className="space-y-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      </div>

      {/* Habits card */}
      <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6">
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-12 w-12 rounded-full" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>

      {/* Two generic widget cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6"
        >
          <Skeleton className="h-4 w-1/3 mb-4" />
          <SkeletonText lines={3} />
        </div>
      ))}
    </div>
  </div>
);
