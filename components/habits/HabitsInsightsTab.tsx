import React, { Suspense } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { BarChart2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';

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
      <EmptyState
        variant="dashed"
        icon={<BarChart2 size={28} />}
        title="No insights yet"
        description="Track a few habits to unlock your category balance and consistency heatmap."
      />
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
