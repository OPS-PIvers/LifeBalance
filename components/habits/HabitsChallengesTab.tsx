import React, { useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { calculateChallengeProgress, type ChallengeProgress } from '@/utils/challengeCalculator';
import { getEffectiveTargetValue } from '@/utils/migrations/challengeMigration';
import { getLocalDateString } from '@/utils/dateHelpers';
import { format, parseISO } from 'date-fns';
import { Check, Pencil, Plus, Trophy, Target } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import type { Challenge } from '@/types/schema';

/** The active monthly challenge rendered as the one elevated "hero" surface. */
const ActiveChallengeCard: React.FC<{
  challenge: Challenge;
  progressData: ChallengeProgress;
  todayDayOfMonth: number;
}> = ({ challenge, progressData, todayDayOfMonth }) => {
  const target = getEffectiveTargetValue(challenge);
  const progress = progressData.progress;

  return (
    <div className="bg-brand-800 dark:bg-brand-900 border border-brand-700 rounded-lg p-5 text-white shadow-raised">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-lg">{challenge.title}</h3>
        <span className="text-xs bg-white/10 px-2 py-1 rounded-btn font-medium tabular-nums">
          Day {todayDayOfMonth} of 30
        </span>
      </div>

      {challenge.description && (
        <p className="text-xs text-brand-200 mb-2">{challenge.description}</p>
      )}

      {challenge.yearlyRewardLabel && (
        <p className="text-xs text-warm-300 mb-3">
          Complete to unlock {challenge.yearlyRewardLabel}
        </p>
      )}

      <div
        className="h-2 w-full bg-brand-700 rounded-full overflow-hidden mb-2 mt-3"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label={`Challenge progress: ${Math.round(progress)}% complete`}
      >
        <div
          className="h-full bg-habit-gold rounded-full transition-all duration-(--duration-slow) ease-(--ease-standard)"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex justify-between text-xxs font-medium text-brand-300">
        <span className="tabular-nums">
          {progressData.currentValue} / {target}
          {challenge.targetType === 'percentage' ? '%' : ''}
        </span>
        <span className="tabular-nums">{progress.toFixed(0)}% complete</span>
      </div>
    </div>
  );
};

/**
 * HabitsChallengesTab — the Challenges sub-tab of the Habits page (redesign IA).
 *
 * Recreates the read surfaces from ChallengeHubModal as grouped-flat, in-page
 * content with warm-amber/evergreen accents: the active monthly challenge with
 * its progress, the yearly-goal 12-month chain, and the freeze-bank token
 * balance. All values come from FROZEN read-only helpers
 * (`calculateChallengeProgress`, `getEffectiveTargetValue`).
 *
 * The heavier MUTATION flows — creating/editing a challenge, spending a freeze
 * token, family challenges, yearly-goal forms — keep their wiring inside
 * ChallengeHubModal. Per the redesign PRIORITY guardrail we don't re-implement
 * them here; an "Edit / manage" CTA opens the existing modal so those flows are
 * never broken. (Phase 3 may fully dissolve the modal.)
 */
export interface HabitsChallengesTabProps {
  /** Opens the existing ChallengeHubModal for create/edit/freeze-token flows. */
  onOpenChallengeHub: () => void;
}

const HabitsChallengesTab: React.FC<HabitsChallengesTabProps> = ({ onOpenChallengeHub }) => {
  const { activeChallenge, habits, primaryYearlyGoal, freezeBank } = useGamification();

  const linkedHabits = useMemo(() => {
    if (!activeChallenge) return [];
    const relatedHabitIdSet = new Set(activeChallenge.relatedHabitIds);
    return habits.filter(h => relatedHabitIdSet.has(h.id));
  }, [activeChallenge, habits]);

  const progressData = useMemo(
    () => (activeChallenge ? calculateChallengeProgress(activeChallenge, linkedHabits) : null),
    [activeChallenge, linkedHabits]
  );

  const todayDayOfMonth = useMemo(() => parseInt(getLocalDateString().slice(8, 10), 10), []);

  const tokenCount = freezeBank?.tokens ?? 0;
  const maxTokens = freezeBank?.maxTokens ?? 3;

  return (
    <div className="space-y-6">
      {/* Active challenge */}
      <Section
        title="This month's challenge"
        action={
          <button
            type="button"
            onClick={onOpenChallengeHub}
            className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-warm-600 dark:hover:text-warm-300 flex items-center gap-1 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-sm"
          >
            {activeChallenge ? (
              <><Pencil size={12} /> Edit</>
            ) : (
              <><Plus size={12} /> New</>
            )}
          </button>
        }
      >
        {activeChallenge && progressData ? (
          <ActiveChallengeCard
            challenge={activeChallenge}
            progressData={progressData}
            todayDayOfMonth={todayDayOfMonth}
          />
        ) : (
          <button
            type="button"
            onClick={onOpenChallengeHub}
            className="w-full flex flex-col items-center text-center py-10 px-6 surface-section hover:border-warm-300 dark:hover:border-warm-700 transition-colors duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            <span className="w-14 h-14 rounded-full bg-warm-100 dark:bg-warm-900/30 text-warm-600 dark:text-warm-200 flex items-center justify-center mb-3">
              <Target size={26} />
            </span>
            <span className="font-display text-base font-semibold text-brand-900 dark:text-brand-50">
              Start a challenge
            </span>
            <span className="text-sm text-brand-500 dark:text-brand-400 mt-1 max-w-xs">
              Set a monthly goal tied to your habits and rally the household.
            </span>
          </button>
        )}
      </Section>

      {/* Yearly goal chain */}
      {primaryYearlyGoal && (
        <Section title="Yearly goal">
          <div className="surface-section p-5">
            <div className="flex items-start justify-between mb-1">
              <h3 className="font-display text-base font-semibold text-brand-900 dark:text-brand-50">
                {primaryYearlyGoal.title}
              </h3>
              <span className="text-xs font-bold tabular-nums text-brand-600 dark:text-brand-300 shrink-0 ml-3">
                {primaryYearlyGoal.successfulMonths.length} / {primaryYearlyGoal.requiredMonths}
              </span>
            </div>
            {primaryYearlyGoal.description && (
              <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">{primaryYearlyGoal.description}</p>
            )}

            {/* 12-circle monthly chain */}
            <div className="grid grid-cols-6 gap-3 mt-4">
              {Array.from({ length: 12 }, (_, i) => {
                const monthIndex = i + 1;
                const monthKey = `${primaryYearlyGoal.year}-${String(monthIndex).padStart(2, '0')}`;
                const isCompleted = primaryYearlyGoal.successfulMonths.includes(monthKey);
                const isCurrentMonth = monthKey === getLocalDateString().slice(0, 7);
                return (
                  <div key={monthKey} className="flex flex-col items-center">
                    <div
                      className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                        isCompleted
                          ? 'bg-accent-600 text-white dark:bg-accent-500'
                          : isCurrentMonth
                            ? 'bg-brand-100 dark:bg-brand-700 text-brand-600 dark:text-brand-300 ring-2 ring-warm-400'
                            : 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-500'
                      }`}
                    >
                      {isCompleted ? <Check size={16} strokeWidth={3} /> : monthIndex}
                    </div>
                    <span className="text-xxs text-brand-400 dark:text-brand-500 mt-1 font-medium">
                      {format(parseISO(`${monthKey}-01`), 'MMM')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>
      )}

      {/* Freeze bank */}
      <Section
        title="Freeze bank"
        action={
          <button
            type="button"
            onClick={onOpenChallengeHub}
            className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-warm-600 dark:hover:text-warm-300 flex items-center gap-1 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-sm"
          >
            Use a token
          </button>
        }
      >
        <div className="surface-section p-5">
          <div className="flex items-center justify-center gap-3 mb-3">
            {Array.from({ length: maxTokens }, (_, i) => (
              <div
                key={i}
                className={`w-14 h-14 rounded-full flex items-center justify-center text-2xl transition-all ${
                  i < tokenCount
                    ? 'bg-habit-blue/15 dark:bg-habit-blue/20 ring-2 ring-habit-blue/40'
                    : 'bg-brand-100 dark:bg-brand-700/50 opacity-50'
                }`}
                aria-hidden="true"
              >
                ❄️
              </div>
            ))}
          </div>
          <p className="text-center text-sm font-medium text-brand-600 dark:text-brand-300 tabular-nums">
            {tokenCount} / {maxTokens} tokens available
          </p>

          {/* Recent history */}
          {(freezeBank?.history?.length ?? 0) > 0 && (
            <div className="mt-5 pt-4 border-t border-brand-200 dark:border-brand-700">
              <h4 className="text-xxs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wide mb-3">
                Recent history
              </h4>
              <ul className="space-y-2">
                {(freezeBank?.history ?? [])
                  .slice(-3)
                  .reverse()
                  .map(entry => (
                    <li key={entry.id} className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-brand-700 dark:text-brand-200">
                          {entry.type === 'used' ? 'Token used' : entry.type === 'earned' ? 'Token earned' : 'Rollover'}
                        </p>
                        {entry.notes && (
                          <p className="text-xs text-brand-400 dark:text-brand-500 truncate">{entry.notes}</p>
                        )}
                      </div>
                      <span
                        className={`font-mono font-bold tabular-nums shrink-0 ml-3 ${
                          entry.amount > 0 ? 'text-money-pos' : 'text-brand-500 dark:text-brand-400'
                        }`}
                      >
                        {entry.amount > 0 ? '+' : ''}
                        {entry.amount}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* Footer hint */}
      <p className="flex items-center justify-center gap-1.5 text-xs text-brand-400 dark:text-brand-500">
        <Trophy size={12} />
        Monthly challenges automatically advance your yearly goal.
      </p>
    </div>
  );
};

export default HabitsChallengesTab;
