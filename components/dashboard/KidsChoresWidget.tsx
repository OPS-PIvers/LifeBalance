import React, { useMemo } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { Habit, HouseholdMember } from '@/types/schema';
import { Star, Sparkles } from 'lucide-react';

/**
 * KidsChoresWidget — a compact, read-only glass summary card that gives a parent
 * an at-a-glance view of each managed kid's chore progress for today (Plan 080c-4).
 *
 * Assignment is kids-only, so any habit with `assignedTo` set is a kid chore.
 * The widget is doubly dormant: it self-nulls unless Kid Mode is on AND there is
 * at least one managed kid with at least one assigned chore. In a normal
 * household (no managed members, no assigned habits) it renders nothing, so
 * dropping it into the Dashboard stack is a zero-behavior-change addition.
 *
 * Theme: purple kid accents, matching components/kid/KidDashboard.tsx.
 */
export const KidsChoresWidget: React.FC = () => {
  const { members } = useHouseholdCore();
  const { habits } = useGamification();
  const kidModeEnabled = useKidModeEnabled();

  const today = getLocalDateString();

  // managedKids → each kid's assigned chores; keep only kids that actually have
  // a chore so the empty state collapses the whole widget (dormancy).
  const kidsWithChores = useMemo<{ kid: HouseholdMember; chores: Habit[] }[]>(
    () =>
      members
        .filter(m => m.isManaged === true)
        .map(kid => ({
          kid,
          chores: habits.filter(h => h.assignedTo === kid.uid),
        }))
        .filter(entry => entry.chores.length > 0),
    [members, habits]
  );

  if (!kidModeEnabled || kidsWithChores.length === 0) return null;

  return (
    <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <div className="p-1.5 bg-purple-100 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300 rounded-lg">
            <Sparkles size={14} />
          </div>
          Kids&apos; Chores
        </h2>
      </div>

      <div className="space-y-3">
        {kidsWithChores.map(({ kid, chores }) => {
          const total = chores.length;
          const done = chores.filter(h => isHabitCompletedInCurrentPeriod(h, today)).length;
          const allDone = done === total;
          const points = kid.points?.daily ?? 0;

          return (
            <div
              key={kid.uid}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 bg-purple-50/60 border border-purple-100/60 dark:bg-purple-500/10 dark:border-purple-500/20"
            >
              {/* Avatar */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-extrabold text-white shrink-0"
                style={{ backgroundColor: kid.avatarColor ?? '#7c3aed' }}
                aria-hidden="true"
              >
                {kid.avatarEmoji ?? kid.displayName.charAt(0).toUpperCase()}
              </div>

              {/* Name + today's completion */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {kid.displayName}
                </p>
                <p
                  className={`text-xs font-semibold ${
                    allDone
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-purple-500 dark:text-purple-300'
                  }`}
                >
                  {done}/{total} chores done today
                </p>
              </div>

              {/* Daily points balance */}
              <div className="flex items-center gap-1 shrink-0 rounded-full bg-amber-100 dark:bg-amber-500/20 px-2.5 py-1 text-amber-700 dark:text-amber-300">
                <Star size={12} className="fill-current" aria-hidden="true" />
                <span className="text-xs font-bold tabular-nums">{points}</span>
                <span className="sr-only">daily points</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
