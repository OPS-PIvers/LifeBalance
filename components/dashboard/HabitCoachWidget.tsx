import React from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Trophy, AlertTriangle, Lightbulb, Wand2, MessageCircleHeart } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';
import { Section } from '@/components/ui/Section';
import type { HabitPatternInsight } from '@/services/geminiService.types';

/**
 * F-DASH-03 — Habit Coach card. Wires up the previously-dead
 * `analyzeHabitPatterns()` Gemini function: 3-5 "praise / critique /
 * suggestion" insights about the household's habit patterns, refreshed
 * manually (mirrors InsightWidget's pattern — no auto-generation, no quota
 * burned without the user asking).
 */
const insightIcon = (type: HabitPatternInsight['type']) => {
  switch (type) {
    case 'praise': return <Trophy size={16} />;
    case 'critique': return <AlertTriangle size={16} />;
    case 'suggestion': return <Lightbulb size={16} />;
  }
};

const insightTone = (type: HabitPatternInsight['type']): string => {
  switch (type) {
    case 'praise': return 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300';
    case 'critique': return 'bg-warm-100 text-warm-700 dark:bg-warm-900/40 dark:text-warm-300';
    case 'suggestion': return 'bg-brand-100 text-brand-700 dark:bg-brand-700/40 dark:text-brand-200';
  }
};

export const HabitCoachWidget: React.FC = React.memo(() => {
  const { habits, habitPatterns, isGeneratingHabitPatterns, refreshHabitPatterns } = useGamification();

  // Nothing to coach yet — don't show an empty AI card before there's any
  // habit data to analyze.
  if (!habits || habits.length === 0) return null;

  const patterns = habitPatterns?.patterns ?? [];

  return (
    <Section
      title={<Eyebrow as="span" tone="warm">Habit Coach</Eyebrow>}
      action={
        <Button
          variant="primary"
          size="sm"
          className="min-h-11"
          onClick={refreshHabitPatterns}
          disabled={isGeneratingHabitPatterns}
          leftIcon={<Wand2 size={12} />}
        >
          {isGeneratingHabitPatterns ? 'Analyzing…' : patterns.length > 0 ? 'Refresh' : 'Analyze'}
        </Button>
      }
    >
      {isGeneratingHabitPatterns ? (
        <div className="space-y-3 border-y border-brand-200 dark:border-brand-700 px-1 py-4" aria-live="polite" aria-busy="true">
          <span className="sr-only">Analyzing habit patterns…</span>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : patterns.length > 0 ? (
        <ul className="divide-y divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700">
          {patterns.map((p, idx) => (
            <li key={idx} className="flex items-start gap-3 px-1 py-3">
              <div className={`p-2 rounded-card shrink-0 ${insightTone(p.type)}`}>
                {insightIcon(p.type)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100">
                  {p.title}
                </p>
                <p className="text-sm text-brand-600 dark:text-brand-300 leading-relaxed mt-0.5">
                  {p.description}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-start gap-4 border-y border-brand-200 dark:border-brand-700 px-1 py-4">
          <div className="p-2.5 rounded-card bg-warm-100 text-warm-600 dark:bg-warm-900/40 dark:text-warm-300 shrink-0">
            <MessageCircleHeart size={20} />
          </div>
          <p className="flex-1 text-sm text-brand-600 dark:text-brand-300 leading-relaxed">
            Get a coaching read on your streaks, slumps, and weekend patterns.
          </p>
        </div>
      )}
    </Section>
  );
});

HabitCoachWidget.displayName = 'HabitCoachWidget';
