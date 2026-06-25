import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Habit, HouseholdMember } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';
import HabitCategoryList from '@/components/habits/HabitCategoryList';
import { Settings, Database, ArrowRight, Download, Sparkles, LayoutList, GraduationCap, ListOrdered, Calendar, ListChecks, Check, Flame, Star } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import HabitCreatorWizard from '@/components/modals/HabitCreatorWizard';
import SmartHabitAdjustModal from '@/components/modals/SmartHabitAdjustModal';
import SmartHabitReorderModal from '@/components/modals/SmartHabitReorderModal';
import { HabitCoach } from '@/components/habits/HabitCoach';
import HabitHistoryCalendar from '@/components/habits/HabitHistoryCalendar';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { getLocalDateString } from '@/utils/dateHelpers';
import { generateCsvExport } from '@/utils/exportUtils';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

const HabitsSkeleton: React.FC = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-brand-900 pb-28 pt-6" aria-busy="true" aria-live="polite">
    <span className="sr-only">Loading habits…</span>
    <div className="px-4 mb-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-52" />
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-9 w-9 rounded-xl" />
          <Skeleton className="h-9 w-20 rounded-xl" />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 flex-1 rounded-xl" />
        ))}
      </div>
    </div>

    {/* Habit category groups */}
    <div className="px-4 space-y-6">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi}>
          {/* Category label */}
          <Skeleton className="h-3 w-20 mb-3 ml-2" />
          {/* Habit rows */}
          <div className="space-y-3">
            {Array.from({ length: gi === 0 ? 3 : 2 }).map((_, hi) => (
              <div
                key={hi}
                className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-2xl p-4 flex items-center gap-4"
              >
                <Skeleton className="h-11 w-11 rounded-xl shrink-0" />
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
 * no toggle here; parents track kid chores from inside the kid view. Purple
 * accents match KidDashboard. Rendered only when Kid Mode is on and the kid has
 * at least one chore, so it is dormant by default.
 */
const KidChoresGroup: React.FC<{ kid: HouseholdMember; chores: Habit[] }> = ({ kid, chores }) => {
  const today = getLocalDateString();
  const doneCount = chores.filter(h => h.completedDates.includes(today)).length;

  return (
    <div className="rounded-2xl bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 p-4">
      {/* Kid header: avatar + name + today's completion summary */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-extrabold text-white shrink-0"
          style={{ backgroundColor: kid.avatarColor ?? '#7c3aed' }}
        >
          {kid.avatarEmoji ?? kid.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{kid.displayName}</p>
          <p className="text-xs font-medium text-purple-500 dark:text-purple-300">
            {doneCount}/{chores.length} done today
          </p>
        </div>
      </div>

      {/* Read-only chore rows */}
      <ul className="space-y-2">
        {chores.map(h => {
          const done = h.completedDates.includes(today);
          return (
            <li
              key={h.id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 border ${
                done
                  ? 'bg-purple-50/60 border-purple-100/60 dark:bg-purple-500/10 dark:border-purple-500/20'
                  : 'bg-white border-transparent dark:bg-slate-800/50'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  done
                    ? 'bg-purple-500 text-white'
                    : 'bg-slate-100 text-slate-300 dark:bg-slate-700 dark:text-slate-500'
                }`}
                aria-hidden="true"
              >
                <Check size={14} strokeWidth={3} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold truncate ${done ? 'text-purple-800 dark:text-purple-200' : 'text-slate-700 dark:text-slate-200'}`}>
                  {h.title}
                </p>
                <div className="flex items-center gap-2 text-xxs font-medium text-slate-400 dark:text-slate-500">
                  <span className="inline-flex items-center gap-0.5">
                    <Star size={10} className="fill-current text-amber-500" aria-hidden="true" />
                    {h.basePoints} pts
                  </span>
                  {h.streakDays > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-orange-500">
                      <Flame size={10} aria-hidden="true" />
                      <span aria-hidden="true">{h.streakDays}</span>
                      <span className="sr-only">{h.streakDays} day streak</span>
                    </span>
                  )}
                </div>
              </div>
              <span className={`text-xxs font-bold uppercase tracking-wide ${done ? 'text-purple-500 dark:text-purple-300' : 'text-slate-400 dark:text-slate-500'}`}>
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

  // Memoize derived collections so they don't recompute on unrelated re-renders.
  const habitsNeedingMigration = useMemo(
    () => habits.filter(
      h => !h.hasSubmissionTracking && h.completedDates && h.completedDates.length > 0
    ),
    [habits]
  );

  // Group Habits by Category (with Sorting)
  // Sort habits by order first
  const sortedHabits = useMemo(
    () => [...habits].sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
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

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-brand-900 pb-28 pt-6">
      <Tabs defaultValue="track">
        {/* Page Title & Action */}
        <div className="px-4 mb-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Daily Habits</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">Build your streak, earn rewards.</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleExport}
                disabled={habits.length === 0}
                variant="secondary"
                size="sm"
                title="Export habits to CSV"
                aria-label="Export habits to CSV"
                leftIcon={<Download size={16} />}
              >
                <span className="hidden sm:inline">Export</span>
              </Button>
              <Button
                onClick={() => setIsSmartAdjustOpen(true)}
                disabled={habits.length === 0}
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles size={16} />}
                title="Smart Adjust"
              >
                <span className="hidden sm:inline">Adjust</span>
              </Button>
              <Button
                onClick={() => setIsSmartReorderOpen(true)}
                disabled={habits.length === 0}
                variant="secondary"
                size="sm"
                leftIcon={<ListOrdered size={16} />}
                title="Smart Reorder"
              >
                <span className="hidden sm:inline">Reorder</span>
              </Button>
              <Button
                onClick={() => setIsWizardOpen(true)}
                variant="primary"
                size="sm"
                leftIcon={<Settings size={16} />}
              >
                Manage
              </Button>
            </div>
          </div>

          {/* Tab Switcher */}
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
          </TabsList>
        </div>

        {/* Migration Banner */}
        {habitsNeedingMigration.length > 0 && (
          <div className="px-4 mb-6">
            <button
              onClick={() => navigate('/migrate-submissions')}
              className="w-full bg-linear-to-r from-purple-500 to-indigo-600 text-white rounded-2xl p-4 shadow-lg hover:shadow-xl transition-all active:scale-98"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-xl">
                    <Database size={24} />
                  </div>
                  <div className="text-left">
                    <h3 className="font-bold text-base">Backfill Historical Data</h3>
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
              <div className="flex flex-col items-center text-center py-14 px-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white/50 dark:bg-slate-800/40">
                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-700/50 flex items-center justify-center mb-4 text-slate-400 dark:text-slate-500">
                  <ListChecks size={28} />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">No habits yet</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
                  Start building your streak. Add a habit to begin earning points and rewards.
                </p>
                <Button
                  onClick={() => setIsWizardOpen(true)}
                  variant="primary"
                  size="md"
                  className="mt-5"
                  leftIcon={<Sparkles size={16} />}
                >
                  Create your first habit
                </Button>
              </div>
            )}

            {categories.map((category) => (
              <div key={category}>
                <h2 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 ml-2">
                  {category}
                </h2>
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
        </div>
      </Tabs>

      {/* Kids chores — read-only parent overview (Plan 080c-4).
          Gated on Kid Mode + at least one managed kid with at least one chore,
          so it stays fully dormant in a normal household. */}
      {kidModeEnabled && kidsWithChores.length > 0 && (
        <section className="px-4 pb-6" aria-label="Kids chores">
          <h2 className="flex items-center gap-2 text-xs font-bold text-purple-500 dark:text-purple-300 uppercase tracking-wider mb-3 ml-2">
            <Star size={14} className="fill-current" />
            Kids&apos; chores
          </h2>
          <div className="space-y-5">
            {kidsWithChores.map(({ kid, chores }) => (
              <KidChoresGroup key={kid.uid} kid={kid} chores={chores} />
            ))}
          </div>
        </section>
      )}

      <HabitCreatorWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
      <SmartHabitAdjustModal isOpen={isSmartAdjustOpen} onClose={() => setIsSmartAdjustOpen(false)} />
      <SmartHabitReorderModal isOpen={isSmartReorderOpen} onClose={() => setIsSmartReorderOpen(false)} />
    </div>
  );
};

export default Habits;
