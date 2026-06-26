import React, { Suspense } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { BarChart2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

// recharts is heavy — lazy-load the chart body so it only enters the bundle when
// the Insights tab is actually opened (keeps the Habits page boot lean).
const HabitsInsightsCharts = React.lazy(() => import('./HabitsInsightsCharts'));

/**
 * HabitsInsightsTab — the Insights sub-tab of the Habits page (redesign IA).
 *
 * Surfaces the habit analytics (the former Analytics "Behavior" charts —
 * category-balance radar + 90-day consistency heatmap — plus the relocated
 * "Pulse" effort-vs-spending and week-over-week charts) as a new in-page
 * component. The recharts-backed body is lazy-loaded.
 */
const HabitsInsightsTab: React.FC = () => {
  const { habits } = useGamification();

  if (habits.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-14 px-6 border-2 border-dashed border-brand-200 dark:border-brand-700 rounded-2xl bg-white/50 dark:bg-brand-800/40">
        <div className="w-16 h-16 rounded-full bg-brand-100 dark:bg-brand-700/50 flex items-center justify-center mb-4 text-brand-400 dark:text-brand-500">
          <BarChart2 size={28} />
        </div>
        <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-50">No insights yet</h3>
        <p className="text-sm text-brand-500 dark:text-brand-400 mt-1 max-w-xs">
          Track a few habits to unlock your category balance and consistency heatmap.
        </p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="space-y-6" aria-busy="true">
          <Skeleton className="h-80 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      }
    >
      <HabitsInsightsCharts />
    </Suspense>
  );
};

export default HabitsInsightsTab;
