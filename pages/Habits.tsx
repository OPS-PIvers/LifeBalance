import React, { useState, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Habit, HouseholdMember } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';
import HabitCategoryList from '@/components/habits/HabitCategoryList';
import {
  Database, ArrowRight, Sparkles, LayoutList, GraduationCap, Calendar,
  ListChecks, Check, Flame, Star, BarChart2, Gift, Trophy,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Eyebrow from '@/components/ui/Eyebrow';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import HabitCreatorWizard from '@/components/modals/HabitCreatorWizard';
import SmartHabitAdjustModal from '@/components/modals/SmartHabitAdjustModal';
import SmartHabitReorderModal from '@/components/modals/SmartHabitReorderModal';
import { HabitCoach } from '@/components/habits/HabitCoach';
import HabitHistoryCalendar from '@/components/habits/HabitHistoryCalendar';
import HabitsHeaderMenu from '@/components/habits/HabitsHeaderMenu';
import HabitsRewardsTab from '@/components/habits/HabitsRewardsTab';
import HabitsChallengesTab from '@/components/habits/HabitsChallengesTab';
import HabitsInsightsTab from '@/components/habits/HabitsInsightsTab';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { useDeepLinkTab } from '@/hooks/useDeepLinkTab';
import { getLocalDateString } from '@/utils/dateHelpers';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';
import { generateCsvExport } from '@/utils/exportUtils';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

// Allowed Habits sub-tabs. Module-level so the array identity is stable and
// other screens can deep-link via `navigate('/habits', { state: { tab } })`.
const HABIT_TABS = ['track', 'history', 'coach', 'rewards', 'challenges', 'insights'] as const;

// Lazy-loaded so the heavy modal/Drawer dependencies stay out of the Habits boot
// bundle and only load when a tab's "manage" CTA is actually used (mirrors the
// Dashboard's lazy-modal pattern).
const ChallengeHubModal = React.lazy(() => import('@/components/modals/ChallengeHubModal'));

const HabitsSkeleton: React.FC = () => (
  <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe pt-6" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading habits…</span>
    <div className="px-4 mb-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        {/* Overflow menu trigger */}
        <Skeleton className="h-10 w-10 rounded-card" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 flex-1 rounded-sm" />
        ))}
      </div>
    </div>

    {/* Habit category groups */}
    <div className="px-4 space-y-6">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi}>
          {/* Category label */}
          <Skeleton className="h-3 w-20 mb-3 ml-1" />
          {/* Habit rows */}
          <div className="space-y-3">
            {Array.from({ length: gi === 0 ? 3 : 2 }).map((_, hi) => (
              <div
                key={hi}
                className="surface-section p-4 flex items-center gap-4"
              >
                <Skeleton className="h-11 w-11 rounded-card shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * KidChoresGroup — a read-only summary of one managed kid's assigned chores,
 * shown to the parent on the Habits page (Plan 080c-4). There is intentionally
 * no toggle here; parents track kid chores from inside the kid view. Warm-amber
 * accents match the redesigned household/gamification side. Rendered only when
 * Kid Mode is on and the kid has at least one chore, so it is dormant by default.
 */
const KidChoresGroup: React.FC<{ kid: HouseholdMember; chores: Habit[] }> = ({ kid, chores }) => {
  const today = getLocalDateString();
  const doneCount = chores.filter(h => isHabitCompletedInCurrentPeriod(h, today)).length;

  return (
    <div className="surface-section p-4">
      {/* Kid header: avatar + name + today's completion summary */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-card flex items-center justify-center text-sm font-extrabold text-white shrink-0"
          style={{ backgroundColor: kid.avatarColor ?? '#b87a29' }}
        >
          {kid.avatarEmoji ?? kid.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-brand-900 dark:text-brand-50 truncate">{kid.displayName}</p>
          <p className="text-xs font-medium text-warm-600 dark:text-warm-300">
            {doneCount}/{chores.length} done today
          </p>
        </div>
      </div>

      {/* Read-only chore rows */}
      <ul className="space-y-2">
        {chores.map(h => {
          const done = isHabitCompletedInCurrentPeriod(h, today);
          return (
            <li
              key={h.id}
              className={`flex items-center gap-3 rounded-card px-3 py-2 border ${
                done
                  ? 'bg-warm-50 border-warm-200 dark:bg-warm-900/20 dark:border-warm-800'
                  : 'bg-white border-brand-200 dark:bg-brand-800 dark:border-brand-700'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  done
                    ? 'bg-warm-500 text-white'
                    : 'bg-brand-100 text-brand-300 dark:bg-brand-700 dark:text-brand-500'
                }`}
                aria-hidden="true"
              >
                <Check size={14} strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold truncate ${done ? 'text-warm-800 dark:text-warm-200' : 'text-brand-700 dark:text-brand-200'}`}>
                  {h.title}
                </p>
                <div className="flex items-center gap-2 text-xxs font-medium text-brand-400 dark:text-brand-500">
                  <span className="inline-flex items-center gap-0.5">
                    <Star size={10} className="fill-current text-habit-gold" aria-hidden="true" />
                    {h.basePoints} pts
                  </span>
                  {h.streakDays > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-habit-streak">
                      <Flame size={10} aria-hidden="true" />
                      <span aria-hidden="true">{h.streakDays}</span>
                      <span className="sr-only">{h.streakDays} day streak</span>
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-xxs font-bold uppercase tracking-wide ${done ? 'text-warm-600 dark:text-warm-300' : 'text-brand-400 dark:text-brand-500'}`}>
                {done ? 'Done' : 'To do'}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const Habits: React.FC = () => {
  const navigate = useNavigate();
  const { habits } = useGamification();
  const { isLoading, members } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSmartAdjustOpen, setIsSmartAdjustOpen] = useState(false);
  const [isSmartReorderOpen, setIsSmartReorderOpen] = useState(false);
  const [isChallengeHubOpen, setIsChallengeHubOpen] = useState(false);
  // Controlled so the toolbar points glance can deep-link straight to Rewards.
  const [activeTab, setActiveTab] = useDeepLinkTab('track', HABIT_TABS);

  // Memoize derived collections so they don't recompute on unrelated re-renders.
  const habitsNeedingMigration = useMemo(
    () => habits.filter(
      h => !h.hasSubmissionTracking && h.completedDates && h.completedDates.length > 0
    ),
    [habits]
  );

  // Group Habits by Category (with Sorting)
  // Sort habits by order first. Exclude kid chores (assignedTo set) up front so the
  // category HEADINGS below derive from the same parent-visible set as the grouped
  // rows — otherwise a category holding only kid chores would render an empty
  // heading once Kid Mode is on. `assignedTo` is set only for managed-kid chores,
  // so this is a no-op for normal households (the parent tracker is unchanged).
  const sortedHabits = useMemo(
    () => habits
      .filter(h => !h.assignedTo)
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [habits]
  );

  // Extract categories from sorted habits (Set preserves insertion order which is now sorted order)
  const categories = useMemo<string[]>(
    () => Array.from(new Set(sortedHabits.map(h => h.category))),
    [sortedHabits]
  );

  const groupedHabits = useMemo<Record<string, Habit[]>>(
    () => categories.reduce((acc, category) => {
      // Sort habits within category too
      acc[category] = habits
        .filter(h => h.category === category)
        .filter(h => !h.assignedTo) // Hide kid chores from the parent tracker (assignedTo is set only for managed-kid chores; dormant by default)
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      return acc;
    }, {} as Record<string, Habit[]>),
    [categories, habits]
  );

  // --- Kids chores (read-only parent view, Plan 080c-4) ---
  // Assignment is kids-only, so any habit with `assignedTo` set is a kid chore.
  // This whole section is dormant: in a normal household no member is managed
  // and no habit is assigned, so `kidsWithChores` is empty and nothing renders.
  const kidsWithChores = useMemo<{ kid: HouseholdMember; chores: Habit[] }[]>(
    () =>
      members
        .filter(m => m.isManaged === true)
        .map(kid => ({
          kid,
          chores: habits
            .filter(h => h.assignedTo === kid.uid)
            .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
        }))
        .filter(entry => entry.chores.length > 0),
    [members, habits]
  );

  if (isLoading) {
    return <HabitsSkeleton />;
  }

  const handleExport = () => {
    try {
      if (habits.length === 0) {
        toast.error('No habits to export');
        return;
      }

      const exportData = habits.map(habit => ({
        'Title': habit.title,
        'Category': habit.category,
        'Type': habit.type === 'positive' ? 'Positive' : 'Negative',
        'Period': habit.period === 'daily' ? 'Daily' : 'Weekly',
        'Current Count': habit.count,
        'Target Count': habit.targetCount,
        'Streak Days': habit.streakDays,
        'Lifetime Count': habit.totalCount,
        'Total Completions (Days)': habit.completedDates.length,
        'Last Updated': habit.lastUpdated ? format(new Date(habit.lastUpdated), 'yyyy-MM-dd') : 'N/A',
        'Scoring Type': habit.scoringType,
        'Base Points': habit.basePoints
      }));

      // Sort by Category then Title
      exportData.sort((a, b) => {
        if (a.Category !== b.Category) return a.Category.localeCompare(b.Category);
        return a.Title.localeCompare(b.Title);
      });

      generateCsvExport(exportData, 'habits-export');
      toast.success('Export started');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export habits');
    }
  };

  const hasNoHabits = habits.length === 0;

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe pt-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Editorial title + single overflow menu (collapses Export/Adjust/Reorder/Manage) */}
        <div className="px-4 mb-6 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-brand-900 dark:text-brand-50">
                Habits
              </h1>
              <p className="mt-1 text-sm text-brand-500 dark:text-brand-400 font-medium">
                Build your streak, earn rewards.
              </p>
            </div>
            <HabitsHeaderMenu
              onExport={handleExport}
              onAdjust={() => setIsSmartAdjustOpen(true)}
              onReorder={() => setIsSmartReorderOpen(true)}
              onManage={() => setIsWizardOpen(true)}
              actionsDisabled={hasNoHabits}
            />
          </div>

          {/* Tab Switcher — unified ui/Tabs */}
          <TabsList>
            <TabsTrigger value="track">
              <LayoutList size={16} />
              Track
            </TabsTrigger>
            <TabsTrigger value="history">
              <Calendar size={16} />
              History
            </TabsTrigger>
            <TabsTrigger value="coach">
              <GraduationCap size={16} />
              Coach
            </TabsTrigger>
            <TabsTrigger value="rewards">
              <Gift size={16} />
              Rewards
            </TabsTrigger>
            <TabsTrigger value="challenges">
              <Trophy size={16} />
              Challenges
            </TabsTrigger>
            <TabsTrigger value="insights">
              <BarChart2 size={16} />
              Insights
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Migration Banner — solid warm surface (gradient/glass killed) */}
        {habitsNeedingMigration.length > 0 && (
          <div className="px-4 mb-6">
            <button
              onClick={() => navigate('/migrate-submissions')}
              className="w-full bg-warm-500 hover:bg-warm-600 text-white rounded-lg p-4 shadow-raised transition-[background-color,transform] duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.99] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/15 p-2 rounded-card">
                    <Database size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-display font-semibold text-base">Backfill historical data</h3>
                    <p className="text-xs text-white/90 mt-0.5">
                      {habitsNeedingMigration.length} habit{habitsNeedingMigration.length !== 1 ? 's' : ''} ready to migrate
                    </p>
                  </div>
                </div>
                <ArrowRight size={20} />
              </div>
            </button>
          </div>
        )}

        {/* Main Content */}
        <div className="px-4 pb-6">
          <TabsContent value="track" className="space-y-6">
            {categories.length === 0 && (
              <EmptyState
                variant="dashed"
                icon={<ListChecks size={28} />}
                title="No habits yet"
                description="Start building your streak. Add a habit to begin earning points and rewards."
                action={
                  <Button
                    onClick={() => setIsWizardOpen(true)}
                    variant="primary"
                    size="md"
                    leftIcon={<Sparkles size={16} />}
                  >
                    Create your first habit
                  </Button>
                }
              />
            )}

            {categories.map((category) => (
              <div key={category}>
                <Eyebrow as="h2" className="mb-2 px-1">
                  {category}
                </Eyebrow>
                <HabitCategoryList category={category} habits={groupedHabits[category] ?? []} />
              </div>
            ))}
          </TabsContent>

          <TabsContent value="history">
            <HabitHistoryCalendar />
          </TabsContent>

          <TabsContent value="coach">
            <HabitCoach />
          </TabsContent>

          <TabsContent value="rewards">
            <HabitsRewardsTab />
          </TabsContent>

          <TabsContent value="challenges">
            <HabitsChallengesTab onOpenChallengeHub={() => setIsChallengeHubOpen(true)} />
          </TabsContent>

          <TabsContent value="insights">
            <HabitsInsightsTab />
          </TabsContent>
        </div>
      </Tabs>

      {/* Kids chores — read-only parent overview (Plan 080c-4).
          Gated on Kid Mode + at least one managed kid with at least one chore,
          so it stays fully dormant in a normal household. */}
      {kidModeEnabled && kidsWithChores.length > 0 && (
        <section className="px-4 pb-6" aria-label="Kids chores">
          <Eyebrow as="h2" tone="warm" className="flex items-center gap-2 mb-2 px-1">
            <Star size={14} className="fill-current" />
            Kids&apos; chores
          </Eyebrow>
          <div className="space-y-6">
            {kidsWithChores.map(({ kid, chores }) => (
              <KidChoresGroup key={kid.uid} kid={kid} chores={chores} />
            ))}
          </div>
        </section>
      )}

      <HabitCreatorWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
      <SmartHabitAdjustModal isOpen={isSmartAdjustOpen} onClose={() => setIsSmartAdjustOpen(false)} />
      <SmartHabitReorderModal isOpen={isSmartReorderOpen} onClose={() => setIsSmartReorderOpen(false)} />

      {/* Heavy modals — lazy-mounted only once their tab CTA is used. The Challenge
          hub keeps its create/edit/freeze-token wiring here while the tabs own the
          read/light-mutation surfaces. (Rewards management now lives inline in the
          Rewards tab — the former RewardsModal was dissolved.) */}
      <Suspense fallback={<div className="fixed inset-0 z-modal bg-brand-900/50" />}>
        {isChallengeHubOpen && (
          <ChallengeHubModal isOpen={isChallengeHubOpen} onClose={() => setIsChallengeHubOpen(false)} />
        )}
      </Suspense>
    </div>
  );
};

export default Habits;
