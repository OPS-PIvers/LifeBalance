import React, { useMemo } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useKidModeEnabled } from '@/hooks/useKidModeEnabled';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { resolveAvatarColor } from '@/utils/avatarColor';
import type { Habit, HouseholdMember } from '@/types/schema';
import { Star, Sparkles } from 'lucide-react';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

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
 * Theme: warm-amber household/kid accents (the redesign replaces the old purple).
 */
export const KidsChoresWidget: React.FC = React.memo(() => {
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
    <Section
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={14} className="text-warm-500" aria-hidden="true" />
          Kids&apos; chores
        </span>
      }
    >
      <SurfaceList>
        {kidsWithChores.map(({ kid, chores }) => {
          const total = chores.length;
          const done = chores.filter(h => isHabitCompletedInCurrentPeriod(h, today)).length;
          const allDone = done === total;
          const points = kid.points?.daily ?? 0;

          return (
            <Row key={kid.uid} className="justify-between">
              <div className="flex items-center gap-3 min-w-0">
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded-card flex items-center justify-center text-sm font-extrabold text-white shrink-0"
                  style={{ backgroundColor: resolveAvatarColor(kid.avatarColor, kid.uid) }}
                  aria-hidden="true"
                >
                  {kid.avatarEmoji ?? kid.displayName.charAt(0).toUpperCase()}
                </div>

                {/* Name + today's completion */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-brand-900 dark:text-brand-100 truncate">
                    {kid.displayName}
                  </p>
                  <p
                    className={`text-xs font-semibold ${
                      allDone
                        ? 'text-money-pos dark:text-money-posDark'
                        : 'text-warm-600 dark:text-warm-300'
                    }`}
                  >
                    {done}/{total} chores done today
                  </p>
                </div>
              </div>

              {/* Daily points balance */}
              <div className="flex items-center gap-1 shrink-0 rounded-full bg-warm-100 dark:bg-warm-900/30 px-2.5 py-1 text-warm-700 dark:text-warm-300">
                <Star size={12} className="fill-current" aria-hidden="true" />
                <span className="text-xs font-bold tabular-nums">{points}</span>
                <span className="sr-only">daily points</span>
              </div>
            </Row>
          );
        })}
      </SurfaceList>
    </Section>
  );
});

KidsChoresWidget.displayName = 'KidsChoresWidget';
