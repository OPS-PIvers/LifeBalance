import React, { useEffect, useRef, useState } from 'react';
import { Scale, X, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';
import { toastIcon } from '@/components/ui/toastIcon';
import { Section } from '@/components/ui/Section';
import { generatePointRebalanceSuggestions } from '@/utils/pointRebalance';
import {
  isRebalanceEligible,
  readRebalanceCooldowns,
  persistRebalanceReviewed,
  readAnalysisCache,
  writeAnalysisCache,
} from '@/utils/pointRebalanceCadence';

/**
 * PointRebalanceCard — F-DASH-08. Dashboard surface for
 * `generatePointRebalanceSuggestions()`: suggests raising/lowering a habit's
 * `basePoints` when its recent completion rate says the reward no longer fits,
 * with one-tap Apply/Dismiss.
 *
 * The suggestions are a deterministic, pure calculation over the habits already
 * in memory (`utils/pointRebalance.ts`) — no AI call, no quota. Cadence: gated
 * behind `powerToolsEnabled` (same surface flag as HabitCoach/BudgetHistory);
 * the computed result is still cached per household for `ANALYSIS_CACHE_TTL_MS`
 * (24h) in localStorage so the offered suggestion is stable across a day rather
 * than shifting on every Dashboard mount; suggestions are further filtered to
 * habits not reviewed (applied/dismissed) within `REBALANCE_COOLDOWN_DAYS`
 * (30 days), also tracked in localStorage. Only the single top-eligible
 * suggestion is shown at a time to keep this a light nudge, not a queue.
 */
export const PointRebalanceCard: React.FC = () => {
  const { habits, updateHabit } = useGamification();
  const { householdId } = useHouseholdCore();
  const powerToolsEnabled = usePowerToolsEnabled();

  const [suggestions, setSuggestions] = useState<HabitPointAdjustmentSuggestion[]>([]);
  const [applying, setApplying] = useState(false);
  const fetchedForHousehold = useRef<string | null>(null);

  useEffect(() => {
    if (!powerToolsEnabled || !householdId || habits.length === 0) return;
    if (fetchedForHousehold.current === householdId) return;

    fetchedForHousehold.current = householdId;

    // Reads (localStorage + the analysis) are deferred a macrotask so this
    // effect never calls setState synchronously in its own body (matches the
    // WeeklyRecapCard external-input-subscription pattern) — StrictMode's
    // double-invoke just re-schedules a no-op second read.
    const timer = window.setTimeout(() => {
      const cached = readAnalysisCache<HabitPointAdjustmentSuggestion>(householdId);
      if (cached) {
        setSuggestions(cached);
        return;
      }

      // Analyse EVERY habit — the household's full point range is what bounds a
      // suggestion's scale. Per-habit cooldowns are applied at render below.
      const results = generatePointRebalanceSuggestions(habits);
      writeAnalysisCache(householdId, results);
      setSuggestions(results);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [powerToolsEnabled, householdId, habits]);

  if (!powerToolsEnabled || suggestions.length === 0) return null;

  // Re-check eligibility at render time too — a suggestion cached up to 24h
  // ago could have been reviewed (applied/dismissed) since, e.g. in another
  // tab.
  const cooldowns = readRebalanceCooldowns(suggestions.map(s => s.habitId));
  const habitById = new Map(habits.map(h => [h.id, h]));
  const suggestion = suggestions.find(
    s => habitById.has(s.habitId) && isRebalanceEligible(s.habitId, cooldowns)
  );
  if (!suggestion) return null;

  const habit = habitById.get(suggestion.habitId);
  if (!habit) return null;

  const dismiss = () => {
    persistRebalanceReviewed(suggestion.habitId);
    setSuggestions(prev => prev.filter(s => s.habitId !== suggestion.habitId));
  };

  const apply = async () => {
    setApplying(true);
    try {
      await updateHabit({ ...habit, basePoints: suggestion.suggestedPoints });
      persistRebalanceReviewed(suggestion.habitId);
      setSuggestions(prev => prev.filter(s => s.habitId !== suggestion.habitId));
      toast.success(`${habit.title} is now worth ${suggestion.suggestedPoints} pts`, {
        icon: toastIcon(Scale),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update points');
    } finally {
      setApplying(false);
    }
  };

  const increasing = suggestion.suggestedPoints > suggestion.currentPoints;

  return (
    <Section
      title="Point rebalance"
      action={
        <button
          onClick={dismiss}
          className="p-1 min-h-6 text-brand-400 dark:text-brand-450 hover:text-brand-600 dark:hover:text-brand-300"
          aria-label="Dismiss point rebalance suggestion"
        >
          <X size={16} />
        </button>
      }
    >
      <div className="surface-section p-4 space-y-3">
        <div className="flex gap-3">
          <div className="p-2.5 rounded-card h-fit shrink-0 bg-habit-gold/10 text-habit-gold dark:bg-habit-gold/15">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="font-semibold text-brand-900 dark:text-brand-50">{suggestion.habitTitle}</h4>
              <span className="stat-num text-sm font-bold text-brand-400 dark:text-brand-450 line-through">
                {suggestion.currentPoints} pts
              </span>
              <span
                className={
                  increasing
                    ? 'stat-num text-sm font-bold text-money-pos dark:text-money-posDark'
                    : 'stat-num text-sm font-bold text-money-neg dark:text-money-negDark'
                }
              >
                {suggestion.suggestedPoints} pts
              </span>
            </div>
            <p className="mt-1 text-sm text-brand-500 dark:text-brand-400 leading-relaxed">
              {suggestion.reasoning}
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={dismiss}
            disabled={applying}
            className="px-3 py-1.5 text-xs font-semibold text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-700/50 rounded-btn transition-colors disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={apply}
            disabled={applying}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-accent-600 hover:bg-accent-700 rounded-btn shadow-btn-primary transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </Section>
  );
};
