/**
 * Pure builders for the first-run onboarding wizard's seed data.
 *
 * Kept separate from the wizard component so the conversion logic (preset →
 * Habit, dollars → checking Account) is unit-testable without rendering React.
 * The wizard passes the resulting objects straight to the context's
 * `addHabit` / `addAccount`, which attach `createdBy` and a server timestamp.
 */
import type { Account, Habit } from '@/types/schema';
import type { PresetHabit } from '@/data/presetHabits';
import { EFFORT_POINTS } from '@/data/presetHabits';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * Generate a unique id, with a fallback for non-secure contexts where
 * `crypto.randomUUID` is unavailable. Mirrors the generator used by
 * HabitCreatorWizard so onboarding-seeded habits get the same id shape.
 */
export const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Convert a preset habit into a fresh, ready-to-persist `Habit`.
 *
 * The id is generated client-side (the context's `addHabit` spreads the object
 * into a new Firestore doc; the doc id is separate). State fields start empty so
 * the new habit has no streak/history. `idFactory` is injectable for
 * deterministic tests.
 */
export const presetToHabit = (
  preset: PresetHabit,
  idFactory: () => string = generateId,
): Habit => ({
  id: idFactory(),
  title: preset.title,
  category: preset.category,
  type: preset.type,
  // basePoints is always a positive magnitude — the sign is conveyed
  // entirely by `type` (see habitSign/signedHabitPoints in
  // utils/habitLogic.ts). Mirrors HabitCreatorWizard's preset-toggle path so
  // a preset enabled via onboarding scores identically to one enabled later.
  basePoints: EFFORT_POINTS[preset.effortLevel],
  scoringType: preset.scoringType,
  period: preset.period,
  targetCount: preset.targetCount,
  count: 0,
  totalCount: 0,
  completedDates: [],
  streakDays: 0,
  lastUpdated: getLocalDateString(),
  presetId: preset.id,
  isCustom: false,
  effortLevel: preset.effortLevel,
});

/**
 * Build a starting checking `Account` from a dollar amount.
 *
 * The id is generated client-side (the context's `addAccount` spreads the
 * object and lets Firestore assign the real doc id). `idFactory` is injectable
 * for deterministic tests.
 */
export const buildCheckingAccount = (
  balanceDollars: number,
  idFactory: () => string = generateId,
): Account => ({
  id: idFactory(),
  name: 'Checking',
  type: 'checking',
  balance: balanceDollars,
  lastUpdated: getLocalDateString(),
});
