import React, { useCallback, useEffect, useState, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Habit, HouseholdMember } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';
import HabitCategoryList from '@/components/habits/HabitCategoryList';
import {
  Sparkles, CalendarPlus, ChevronDown,
  ListChecks, Check, Flame, Star, Archive,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Eyebrow from '@/components/ui/Eyebrow';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs';
import { TabSubViewMenu, type TabSubViewOption } from '@/components/ui/TabSubViewMenu';
import { tabValueAtPoint } from '@/components/ui/tabValueAtPoint';
import { SubViewHint } from '@/components/ui/SubViewHint';
import HabitCreatorWizard from '@/components/modals/HabitCreatorWizard';
import SmartHabitAdjustModal from '@/components/modals/SmartHabitAdjustModal';
import SmartHabitReorderModal from '@/components/modals/SmartHabitReorderModal';
import { HabitCoach } from '@/components/habits/HabitCoach';
import HabitHistoryCalendar from '@/components/habits/HabitHistoryCalendar';
import HabitsHeaderMenu from '@/components/habits/HabitsHeaderMenu';
import { HabitsModelPrimerLink } from '@/components/habits/HabitsModelPrimer';
import PageHeader from '@/components/ui/PageHeader';
import HabitsRewardsTab from '@/components/habits/HabitsRewardsTab';
import HabitsChallengesTab from '@/components/habits/HabitsChallengesTab';
import HabitsInsightsTab from '@/components/habits/HabitsInsightsTab';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import { useDayCompleteCelebration } from '@/hooks/useDayCompleteCelebration';
import { LazyMount } from '@/components/ui/LazyMount';
import { useDeepLinkTab } from '@/hooks/useDeepLinkTab';
import { useDeepLinkHighlight } from '@/hooks/useDeepLinkHighlight';
import { useScrollToHighlight } from '@/hooks/useScrollToHighlight';
import { getLocalDateString } from '@/utils/dateHelpers';
import { isHabitCompletedInCurrentPeriod, signedHabitPoints } from '@/utils/habitLogic';
import { haptic } from '@/utils/haptics';
import { resolveAvatarColor } from '@/utils/avatarColor';
import { getCatchUpEligibleHabits } from '@/utils/catchUpHabits';
import { generateCsvExport } from '@/utils/exportUtils';
import toast from 'react-hot-toast';
import { format, subDays } from 'date-fns';

// Habits' IA is 3 top-level tabs (consolidated from 6 — 2026-07 critique):
// Track, Progress (History + Insights + Coach), Rewards (Store + Challenges).
// The multi-view groups' sub-views are chosen from a popover menu anchored
// under the tab itself (TabSubViewMenu): tapping the tab opens its menu,
// picking an item navigates. Coach folded into Progress in the round-3
// critique: it duplicated a Dashboard widget and opened on a pitch, which
// didn't earn a top-level slot. ONE state value holds the full location: the
// legacy view keys stay valid so every existing
// `navigate('/habits', { state: { tab } })` deep-link keeps working and
// selects the right group WITH the right segment (deep-links never open the
// menu — it opens only from user taps).
const HABIT_TABS = [
  'track',
  // Progress group ('history' = its default segment)
  'progress', 'history', 'insights', 'coach',
  // Rewards group
  'rewards', 'challenges',
] as const;

type HabitTabValue = (typeof HABIT_TABS)[number];

/** Collapse any tab value (incl. legacy view keys) to its top-level tab. */
const topTabOf = (value: string): 'track' | 'progress' | 'rewards' => {
  switch (value) {
    case 'history':
    case 'insights':
    case 'coach':
    case 'progress':
      return 'progress';
    case 'rewards':
    case 'challenges':
      return 'rewards';
    default:
      return 'track';
  }
};

/** The multi-view groups — tabs whose tap opens a sub-view menu. */
type HabitGroup = 'progress' | 'rewards';

const isHabitGroup = (value: string): value is HabitGroup =>
  value === 'progress' || value === 'rewards';

// Rewards' options are static; Progress' are built in-component (Coach is
// gated on powerToolsEnabled). Labels double as the active trigger's text.
const REWARDS_OPTIONS: TabSubViewOption<HabitTabValue>[] = [
  // Label only — the legacy 'rewards' view key is load-bearing (deep links,
  // topTabOf, persisted state) and must not change. "Store" avoids the
  // Rewards > Rewards duplicate.
  { value: 'rewards', label: 'Store' },
  { value: 'challenges', label: 'Challenges' },
];

// Lazy-loaded so the heavy modal/Drawer dependencies stay out of the Habits boot
// bundle and only load when a tab's "manage" CTA is actually used (mirrors the
// Dashboard's lazy-modal pattern).
const ChallengeHubModal = React.lazy(() => import('@/components/modals/ChallengeHubModal'));
const PastDayLogModal = React.lazy(() => import('@/components/modals/PastDayLogModal'));
// Peak-end "day complete" moment — lazy so its (motion) chunk stays off boot.
const DayCompleteCelebration = React.lazy(() => import('@/components/habits/DayCompleteCelebration'));

const HabitsSkeleton: React.FC = () => (
  <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe pt-6" aria-busy="true" aria-live="polite">
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
 * KidChoresGroup — a summary of one managed kid's assigned chores, shown to
 * the parent on the Habits page (Plan 080c-4). Each chore row is toggleable
 * by the parent — e.g. to mark a chore done on the kid's behalf when they
 * report it verbally — through the SAME `toggleHabit` path every other habit
 * uses (hooks/useHabitActions.tsx), so points/streak semantics are identical:
 * the assignee's own `points` doc is credited (habitPointsTargetRef routes on
 * `habit.assignedTo`), never the shared household pool. Warm-amber accents
 * match the redesigned household/gamification side. Rendered only when Kid
 * Mode is on and the kid has at least one chore, so it is dormant by default.
 */
const KidChoresGroup: React.FC<{ kid: HouseholdMember; chores: Habit[] }> = ({ kid, chores }) => {
  const { toggleHabit } = useGamification();
  // Guard against rapid double-taps on a chore row: toggleHabit's batch write
  // is async, so a second tap before the first resolves would double-credit
  // points/streak. Rows disable while their toggle is in flight.
  const [pendingChoreIds, setPendingChoreIds] = useState<ReadonlySet<string>>(new Set());
  const today = getLocalDateString();
  const doneCount = chores.filter(h => isHabitCompletedInCurrentPeriod(h, today)).length;

  const handleToggle = async (habit: Habit, done: boolean) => {
    if (pendingChoreIds.has(habit.id)) return;
    haptic(done ? 'light' : 'success');
    setPendingChoreIds(prev => new Set(prev).add(habit.id));
    try {
      await toggleHabit(habit.id, done ? 'down' : 'up');
    } finally {
      setPendingChoreIds(prev => {
        const next = new Set(prev);
        next.delete(habit.id);
        return next;
      });
    }
  };

  return (
    <div className="surface-section p-4">
      {/* Kid header: avatar + name + today's completion summary */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-card flex items-center justify-center text-sm font-extrabold text-white shrink-0"
          style={{ backgroundColor: resolveAvatarColor(kid.avatarColor, kid.uid) }}
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

      {/* Chore rows — each is a button so the parent can toggle completion on
          the kid's behalf (e.g. when the kid reports a chore done verbally)
          via the same toggleHabit path every other habit uses. */}
      <ul className="space-y-2">
        {chores.map(h => {
          const done = isHabitCompletedInCurrentPeriod(h, today);
          return (
            <li key={h.id}>
              <button
                type="button"
                disabled={pendingChoreIds.has(h.id)}
                onClick={() => void handleToggle(h, done)}
                aria-pressed={done}
                aria-label={`Toggle chore: ${h.title}, currently ${done ? 'done' : 'not done'}`}
                className={`w-full flex items-center gap-3 rounded-card px-3 py-2 border text-left transition-colors active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900 ${
                  done
                    ? 'bg-warm-50 border-warm-200 hover:bg-warm-100 dark:bg-warm-900/20 dark:border-warm-800 dark:hover:bg-warm-900/30'
                    : 'bg-white border-brand-200 hover:bg-brand-50 dark:bg-brand-800 dark:border-brand-700 dark:hover:bg-brand-700/40'
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-warm-500 text-white'
                      : 'bg-brand-100 text-brand-300 dark:bg-brand-700 dark:text-brand-450'
                  }`}
                  aria-hidden="true"
                >
                  <Check size={14} strokeWidth={3} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${done ? 'text-warm-800 dark:text-warm-200' : 'text-brand-700 dark:text-brand-200'}`}>
                    {h.title}
                  </p>
                  <div className="flex items-center gap-2 text-xxs font-medium text-brand-400 dark:text-brand-450">
                    <span className="inline-flex items-center gap-0.5">
                      <Star size={10} className="fill-current text-habit-gold" aria-hidden="true" />
                      {signedHabitPoints(h)} pts
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
                <span className={`text-xxs font-bold uppercase tracking-wide ${done ? 'text-warm-600 dark:text-warm-300' : 'text-brand-400 dark:text-brand-450'}`}>
                  {done ? 'Done' : 'To do'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const Habits: React.FC = () => {
  const { habits, toggleHabit } = useGamification();
  const { isLoading, members } = useHouseholdCore();
  const kidModeEnabled = useKidModeEnabled();
  const powerToolsEnabled = usePowerToolsEnabled();
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSmartAdjustOpen, setIsSmartAdjustOpen] = useState(false);
  const [isSmartReorderOpen, setIsSmartReorderOpen] = useState(false);
  const [isChallengeHubOpen, setIsChallengeHubOpen] = useState(false);
  const [isPastDayLogOpen, setIsPastDayLogOpen] = useState(false);
  // F-HABITS-05: Track tab toggles between active and archived habits.
  const [showArchived, setShowArchived] = useState(false);
  // Controlled so the toolbar points glance can deep-link straight to Rewards.
  // `activeView` may be a legacy view key ('history', 'challenges', …) — the
  // Tabs bar renders its top-level group (the active trigger's label showing
  // the specific view) and the panel renders that view's content (same
  // pattern as Money's 4-tab IA).
  const [activeView, setActiveView] = useDeepLinkTab('track', HABIT_TABS);
  const activeTab = topTabOf(activeView);
  // Which multi-view tab's sub-view menu is open (null = none). Opened only by
  // taps on a group trigger — never by deep-links or keyboard arrow roving.
  const [openMenu, setOpenMenu] = useState<HabitGroup | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  // Reached only by single-view taps (Track) and the tablist's arrow-key
  // activation (taps on multi-view triggers are intercepted in capture phase
  // below) — keyboard selection-follows-focus keeps its existing
  // land-on-default behavior.
  const selectTab = (value: string) => {
    // Defensive invariant: a tab change (however triggered — keyboard roving
    // or a future programmatic onValueChange) always dismisses any open menu,
    // so a stale group's menu can never float over the newly-active tab.
    setOpenMenu(null);
    // Entering a group via its top trigger shows the group's default segment.
    setActiveView(value === 'progress' ? 'history' : value);
  };
  // Tapping (or Enter/Space-ing) a multi-view trigger toggles its sub-view
  // menu WITHOUT changing the selected tab; navigation happens only when a
  // menu item is picked. stopPropagation in the capture phase keeps the event
  // from ever reaching the trigger's own onClick. While the menu is open its
  // backdrop covers the tab bar, so taps arrive here with the backdrop as
  // target — hit-testing recovers the intended trigger so a tap on ANOTHER
  // tab acts in one tap (switch menus, or navigate for a single-view tab)
  // instead of just dismissing; a re-tap on the same tab still closes.
  const handleTabBarClickCapture = (e: React.MouseEvent) => {
    let value = (e.target as HTMLElement)
      .closest('[data-tabs-value]')
      ?.getAttribute('data-tabs-value');
    if (!value && openMenu) {
      value = tabValueAtPoint(tabBarRef.current, e.clientX, e.clientY) ?? undefined;
      if (value && !isHabitGroup(value)) {
        // Single-view tab (Track) under the backdrop: dismiss + navigate.
        e.stopPropagation();
        selectTab(value);
        return;
      }
    }
    if (value && isHabitGroup(value)) {
      e.stopPropagation();
      setOpenMenu((prev) => (prev === value ? null : value));
    }
  };
  // Coach is a Progress segment gated on powerToolsEnabled: a stale
  // `?tab=coach` deep-link while the flag is off degrades to History instead
  // of an empty view.
  const progressSegment: HabitTabValue =
    activeView === 'insights' ? 'insights'
    : activeView === 'coach' && powerToolsEnabled ? 'coach'
    : 'history';
  const rewardsSegment: HabitTabValue = activeView === 'challenges' ? 'challenges' : 'rewards';
  // Coach is flag-gated, so Progress' menu options are built here (the other
  // groups' are static module constants).
  const progressOptions = useMemo<TabSubViewOption<HabitTabValue>[]>(
    () => [
      { value: 'history', label: 'History' },
      { value: 'insights', label: 'Insights' },
      ...(powerToolsEnabled ? [{ value: 'coach' as const, label: 'Coach' }] : []),
    ],
    [powerToolsEnabled]
  );
  const groupOptions: Record<HabitGroup, TabSubViewOption<HabitTabValue>[]> = {
    progress: progressOptions,
    rewards: REWARDS_OPTIONS,
  };
  const groupSegment: Record<HabitGroup, HabitTabValue> = {
    progress: progressSegment,
    rewards: rewardsSegment,
  };
  // Multi-view trigger content: the CURRENT sub-view name while its group is
  // active, the group name otherwise — always with the small caret that
  // signals "this tab opens a menu". The caret is aria-hidden, so the
  // inactive accessible name stays the plain group name (e2e contract).
  const groupTrigger = (group: HabitGroup, groupName: string) => (
    <>
      {activeTab === group
        ? (groupOptions[group].find((o) => o.value === groupSegment[group])?.label ?? groupName)
        : groupName}
      <ChevronDown size={12} aria-hidden="true" className="-ml-1.5" />
    </>
  );
  // F-HABITS-03: a per-habit reminder push deep-links to `?due=<id>,<id>` so
  // the page opens on exactly the habits it just nudged about, instead of the
  // full list the member then has to search. Read straight from the router (no
  // read-and-strip) so the filter survives a refresh and can't race the
  // nact/nhabit consumers; the chip's "Show all" is what clears it.
  const [searchParams, setSearchParams] = useSearchParams();
  const dueParam = searchParams.get('due');
  const dueIds = useMemo(() => {
    const ids = (dueParam ?? '').split(',').map(id => id.trim()).filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
  }, [dueParam]);
  // Only filter on ids that actually resolve — a stale link (habit since
  // deleted) should show the normal list, not an empty page.
  const dueFilter = useMemo(
    () => (dueIds && habits.some(h => dueIds.has(h.id)) ? dueIds : null),
    [dueIds, habits]
  );
  const clearDueFilter = useCallback(() => {
    setSearchParams(
      prev => {
        prev.delete('due');
        return prev;
      },
      { replace: true }
    );
  }, [setSearchParams]);
  // Land on Track when a reminder deep-links in: the filtered habits only exist
  // there, so arriving with Progress/Rewards still selected would show nothing
  // of what the push was about.
  useEffect(() => {
    if (dueFilter) {
      setActiveView('track');
      return;
    }
    // A link whose habits have all since been deleted renders no banner, so
    // there'd be no visible way to clear the param it left behind — drop it
    // ourselves rather than let a dead filter ride along in a refresh or share.
    if (dueIds) clearDueFilter();
  }, [dueFilter, dueIds, setActiveView, clearDueFilter]);
  // The archived view and the reminder filter can't both hold: their intersection
  // is always empty (a reminder never names an archived habit), which would show
  // a bare "From your reminder: 0 habits". Asking for archived habits SUSPENDS
  // the filter rather than clearing it, so toggling back restores what the push
  // was about instead of silently discarding the link.
  const appliedDueFilter = showArchived ? null : dueFilter;

  // Global search deep-link (v1.1): scroll-to + briefly flash the specific
  // habit row selected in SearchOverlay, on top of the tab-level jump above.
  const highlightHabitId = useDeepLinkHighlight();
  useScrollToHighlight(highlightHabitId);
  const [isCatchingUp, setIsCatchingUp] = useState(false);

  // Peak-end: fire the "day complete" moment when the last due daily habit is
  // finished (once per local day per device). Provider-agnostic — reads the
  // gamification slice, so it works the same in Test Mode.
  const dayComplete = useDayCompleteCelebration();

  // Group Habits by Category (with Sorting)
  // Sort habits by order first. Exclude kid chores (assignedTo set) up front so the
  // category HEADINGS below derive from the same parent-visible set as the grouped
  // rows — otherwise a category holding only kid chores would render an empty
  // heading once Kid Mode is on. `assignedTo` is set only for managed-kid chores,
  // so this is a no-op for normal households (the parent tracker is unchanged).
  const sortedHabits = useMemo(
    () => habits
      .filter(h => !h.assignedTo)
      .filter(h => showArchived ? !!h.archivedAt : !h.archivedAt)
      .filter(h => !appliedDueFilter || appliedDueFilter.has(h.id))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [habits, showArchived, appliedDueFilter]
  );

  // F-HABITS-09: habits eligible for the "Catch up yesterday" bulk action —
  // derived from the same parent-visible/unassigned set as `sortedHabits` so
  // kid chores (assigned to a managed member) are never bulk-completed here.
  const catchUpEligibleHabits = useMemo(() => {
    const today = getLocalDateString();
    const yesterday = getLocalDateString(subDays(new Date(), 1));
    return getCatchUpEligibleHabits(sortedHabits, today, yesterday);
  }, [sortedHabits]);

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
        .filter(h => showArchived ? !!h.archivedAt : !h.archivedAt)
        .filter(h => !appliedDueFilter || appliedDueFilter.has(h.id))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      return acc;
    }, {} as Record<string, Habit[]>),
    [categories, habits, showArchived, appliedDueFilter]
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
        'Base Points': signedHabitPoints(habit)
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

  // Sequentially (not Promise.all) so we don't fire a burst of concurrent
  // writeBatches — mirrors the per-habit toggleHabit atomicity guarantee
  // without racing multiple batches against the same household points doc.
  const handleCatchUpYesterday = async () => {
    if (isCatchingUp || catchUpEligibleHabits.length === 0) return;
    setIsCatchingUp(true);
    let caughtUp = 0;
    let failed = 0;
    for (const habit of catchUpEligibleHabits) {
      try {
        await toggleHabit(habit.id, 'up');
        caughtUp += 1;
      } catch (error) {
        // toggleHabit doesn't surface its own error toast, so a single
        // habit failing here must not abort the rest of the queue.
        failed += 1;
        console.error(`[handleCatchUpYesterday] Failed for habit ${habit.id}:`, error);
      }
    }
    if (caughtUp > 0) {
      toast.success(`Caught up ${caughtUp} habit${caughtUp === 1 ? '' : 's'} from yesterday`);
    }
    if (failed > 0) {
      toast.error(`Failed to catch up ${failed} habit${failed === 1 ? '' : 's'}`);
    }
    setIsCatchingUp(false);
  };

  const hasNoHabits = habits.length === 0;

  return (
    <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe">
      <Tabs value={activeTab} onValueChange={selectTab}>
        {/* Compact PageHeader (title+subtitle) with the overflow menu as its
            actions slot, replacing the hand-rolled pt-8/text-3xl header — see
            UX content audit Batch 4. */}
        <PageHeader
          title="Habits"
          subtitle="Build your streak, earn rewards."
          actions={
            <div className="flex items-center gap-2">
              {/* Backfill entry point: opens the past-day log drawer. Sits inline
                  with the overflow menu and mirrors its trigger styling so the
                  header stays one calm row. */}
              {/* Gate on the parent-visible set (kid chores excluded) — a
                  household whose only habits are kid chores has nothing to
                  backfill here. */}
              <button
                type="button"
                onClick={() => setIsPastDayLogOpen(true)}
                disabled={sortedHabits.length === 0}
                className="relative before:absolute before:-inset-0.5 before:content-[''] shrink-0 p-2.5 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-card text-brand-500 dark:text-brand-400 hover:text-warm-600 dark:hover:text-warm-300 hover:border-brand-300 dark:hover:border-brand-600 active:scale-95 transition-[transform,color,border-color] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Log habits for a past day"
              >
                <CalendarPlus size={20} />
              </button>
              <HabitsHeaderMenu
                onExport={handleExport}
                onAdjust={() => setIsSmartAdjustOpen(true)}
                onReorder={() => setIsSmartReorderOpen(true)}
                onManage={() => setIsWizardOpen(true)}
                onCatchUpYesterday={handleCatchUpYesterday}
                actionsDisabled={hasNoHabits}
                catchUpDisabled={catchUpEligibleHabits.length === 0 || isCatchingUp}
                showSmartTools={powerToolsEnabled}
                onToggleArchived={() => setShowArchived(prev => !prev)}
                showingArchived={showArchived}
              />
            </div>
          }
        />

        {/* Tab Switcher — sm size: this is a secondary in-page filter, not
            primary bottom-nav-adjacent navigation (only "Track" is the
            daily-use default). STICKY strip (unified page-scroll model): pins
            at the top of MainLayout's single page scroller while content
            passes beneath, with the page background + bottom hairline matching
            ListsPage's tab strip exactly. */}
        <div className="px-4 pt-3 pb-2 sticky top-0 z-30 bg-brand-50 dark:bg-brand-900 border-b border-brand-200 dark:border-brand-800">
          {/* Text-only triggers (matching Money's tab bar) — icons made the
              consolidated bar overflow 375px, which is the exact problem this
              consolidation removes. text-[13px] + px-2.5 buy the room the
              sub-view labels + carets need at that width. The relative wrapper
              is the anchor container for TabSubViewMenu; the capture handler
              intercepts multi-view taps before Tabs sees them. */}
          <div ref={tabBarRef} className="relative" onClickCapture={handleTabBarClickCapture}>
            <TabsList equalWidth>
              <TabsTrigger value="track" className="text-[13px] px-2.5">
                Track
              </TabsTrigger>
              <TabsTrigger
                value="progress"
                className="text-[13px] px-2.5"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'progress'}
              >
                {groupTrigger('progress', 'Progress')}
              </TabsTrigger>
              <TabsTrigger
                value="rewards"
                className="text-[13px] px-2.5"
                aria-haspopup="menu"
                aria-expanded={openMenu === 'rewards'}
              >
                {groupTrigger('rewards', 'Rewards')}
              </TabsTrigger>
            </TabsList>
            {openMenu && (
              <TabSubViewMenu
                // Remount on group switch (tab-to-tab tap while open) so the
                // focus trap re-initializes onto the NEW menu's checked item
                // and the entrance animation replays under the new anchor.
                key={openMenu}
                isOpen
                onClose={() => setOpenMenu(null)}
                options={groupOptions[openMenu]}
                // Checked = "you are here": only when this menu's group is the
                // active tab. Previewing another group's menu (tab-to-tab tap)
                // checks nothing — its default segment isn't the current page.
                value={activeTab === openMenu ? groupSegment[openMenu] : undefined}
                onSelect={setActiveView}
                name={openMenu === 'progress' ? 'Progress view' : 'Rewards view'}
                anchorValue={openMenu}
                anchorRef={tabBarRef}
                tone="warm"
              />
            )}
          </div>
        </div>
        {/* One-time coach hint for the tab-popover nav — first visit only;
            opening any tab menu, the ×, or navigating away latches it off for
            good (shared with the Money page). Sibling of the tab-bar wrapper,
            not a child: inside the (now sticky) strip its dismissal would
            resize the pinned strip; out here it scrolls with the content and
            only its own slot collapses. */}
        <SubViewHint menuOpened={openMenu !== null} className="mx-4 mt-4" />

        {/* Main Content */}
        <div className="px-4 pt-4 pb-6">
          <TabsContent value="track" className="space-y-6">
            {/* F-HABITS-03: arrived from a per-habit reminder push. Says what
                was filtered out and offers the way back, so a narrowed list is
                never mistaken for "these are all my habits". */}
            {appliedDueFilter && (
              <div className="flex items-center justify-between gap-3 rounded-card border border-warm-200 dark:border-warm-900 bg-warm-50 dark:bg-warm-900/20 px-3 py-2.5">
                <p className="text-sm text-brand-700 dark:text-brand-200">
                  From your reminder: {sortedHabits.length} habit
                  {sortedHabits.length === 1 ? '' : 's'}
                </p>
                <button
                  type="button"
                  onClick={clearDueFilter}
                  className="shrink-0 text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 min-h-11 -my-3 px-2 -mx-2 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-sm"
                >
                  Show all
                </button>
              </div>
            )}

            {categories.length === 0 && !showArchived && (
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

            {categories.length === 0 && showArchived && (
              <EmptyState
                variant="dashed"
                icon={<Archive size={28} />}
                title="No archived habits"
                description="Habits you archive will show up here, still tracked in Insights and history."
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

            {/* Kids chores — read-only parent overview (Plan 080c-4). Scoped to
                the Track tab (rather than rendering below every tab's content
                regardless of which is active) since it's part of the daily
                tracking view — see UX content audit Batch 4. Gated on Kid Mode
                + at least one managed kid with at least one chore, so it stays
                fully dormant in a normal household. */}
            {/* Also hidden while a reminder link is filtering the page: the
                banner above says "N habits", and kid chores are neither in that
                count nor part of what the push was about. */}
            {!showArchived && !appliedDueFilter && kidModeEnabled && kidsWithChores.length > 0 && (
              <section aria-label="Kids chores">
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

            {/* Quiet primer disclosure (same idiom as SafeToSpendDetail's
                money-primer link): the streak/multiplier/freeze math explained
                one tap from the daily surface instead of 4 taps deep. */}
            <HabitsModelPrimerLink className="px-1" />
          </TabsContent>

          {/* No in-panel view chooser: the sub-view lives in the tab itself
              (tap the tab → TabSubViewMenu popover), so each panel renders
              its current segment directly. */}
          <TabsContent value="progress">
            {progressSegment === 'coach' ? (
              <HabitCoach />
            ) : progressSegment === 'history' ? (
              <HabitHistoryCalendar />
            ) : (
              <HabitsInsightsTab />
            )}
          </TabsContent>

          <TabsContent value="rewards">
            {rewardsSegment === 'rewards' ? (
              <HabitsRewardsTab />
            ) : (
              <HabitsChallengesTab onOpenChallengeHub={() => setIsChallengeHubOpen(true)} />
            )}
          </TabsContent>
        </div>
      </Tabs>

      <HabitCreatorWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
      {powerToolsEnabled && (
        <>
          <SmartHabitAdjustModal isOpen={isSmartAdjustOpen} onClose={() => setIsSmartAdjustOpen(false)} />
          <SmartHabitReorderModal isOpen={isSmartReorderOpen} onClose={() => setIsSmartReorderOpen(false)} />
        </>
      )}

      {/* Heavy modals — lazy-mounted only once their tab CTA is used. The Challenge
          hub keeps its create/edit/freeze-token wiring here while the tabs own the
          read/light-mutation surfaces. (Rewards management now lives inline in the
          Rewards tab — the former RewardsModal was dissolved.) */}
      <Suspense fallback={<div className="fixed inset-0 z-modal bg-brand-900/50" />}>
        {isChallengeHubOpen && (
          <ChallengeHubModal isOpen={isChallengeHubOpen} onClose={() => setIsChallengeHubOpen(false)} />
        )}
        {isPastDayLogOpen && (
          <PastDayLogModal isOpen={isPastDayLogOpen} onClose={() => setIsPastDayLogOpen(false)} />
        )}
      </Suspense>

      {/* Peak-end celebration — lazy-mounted only once the day is first completed. */}
      <LazyMount when={dayComplete.isOpen && dayComplete.summary !== null}>
        {dayComplete.isOpen && dayComplete.summary && (
          <DayCompleteCelebration summary={dayComplete.summary} onClose={dayComplete.close} />
        )}
      </LazyMount>
    </div>
  );
};

export default Habits;
