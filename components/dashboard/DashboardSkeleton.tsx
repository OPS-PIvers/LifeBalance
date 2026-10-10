import React from 'react';
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';

/**
 * Loading placeholder for the Dashboard. Mirrors the real triage layout (serif
 * greeting + the elevated hero + the Pulse strip + grouped-flat sections) so the
 * page doesn't reflow when data arrives.
 */
export const DashboardSkeleton: React.FC = () => (
  <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-32" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading your dashboard…</span>

    {/* Greeting header */}
    <div className="px-5 pt-5 pb-4 flex items-end justify-between">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
      <Skeleton className="h-11 w-11 rounded-card" />
    </div>

    <div className="px-4 space-y-6">
      {/* Hero (the one elevated surface) */}
      <Skeleton className="h-36 w-full rounded-lg" />

      {/* Pulse strip — mirror the titled, hairline-edged columned ledger (not a card) */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <div className="grid grid-cols-3 divide-x divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 px-2 py-4">
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </div>
      </div>

      {/* Action Queue section */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <div className="surface-section p-4 space-y-3">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      </div>

      {/* Habits section */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <div className="surface-section p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-btn" />
          ))}
        </div>
      </div>

      {/* Insight + activity */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="surface-section p-5">
          <Skeleton className="h-4 w-1/3 mb-4" />
          <SkeletonText lines={3} />
        </div>
      ))}
    </div>
  </div>
);
