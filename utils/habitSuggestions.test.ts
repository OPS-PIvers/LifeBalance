import { describe, it, expect } from 'vitest';
import { suggestHabitsForTransaction, getTopHabitSuggestions } from './habitSuggestions';
import { Habit, Transaction } from '@/types/schema';

// Minimal Habit factory — only fields used by habitSuggestions
const habit = (
  id: string,
  title: string,
  category: string,
  type: Habit['type'] = 'positive',
): Habit =>
  ({
    id,
    title,
    category,
    type,
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2024-01-01',
    weatherSensitive: false,
  } as Habit);

// Minimal Transaction factory
const tx = (
  merchant: string,
  relatedHabitIds: string[] = [],
): Transaction =>
  ({
    id: merchant,
    amount: 10,
    merchant,
    category: 'Groceries',
    date: '2024-01-01',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    relatedHabitIds,
  } as Transaction);

describe('suggestHabitsForTransaction', () => {
  it('returns low-confidence "No suggestions" entries when merchant is empty', () => {
    const habits = [habit('h1', 'Exercise', 'fitness')];
    const result = suggestHabitsForTransaction('', habits, []);

    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe('low');
    expect(result[0]!.reason).toBe('No suggestions');
  });

  it('returns empty array when habits list is empty', () => {
    const result = suggestHabitsForTransaction('Starbucks', [], []);
    expect(result).toHaveLength(0);
  });

  it('matches coffee-category keywords and boosts negative habit for coffee merchant', () => {
    const coffeeNegHabit = habit('h-coffee-neg', 'Too much coffee', 'coffee', 'negative');
    const unrelatedHabit = habit('h-gym', 'Go to the gym', 'fitness', 'positive');
    const habits = [coffeeNegHabit, unrelatedHabit];

    const result = suggestHabitsForTransaction('Starbucks', habits, []);

    // The coffee-negative habit should score higher than the unrelated gym habit
    const coffeeEntry = result.find(s => s.habit.id === 'h-coffee-neg')!;
    const gymEntry = result.find(s => s.habit.id === 'h-gym')!;
    expect(coffeeEntry).toBeDefined();
    expect(gymEntry).toBeDefined();

    // coffee merchant hits 'coffee' keyword → keyword match + negative-spend boost
    // gym has no keyword overlap with 'Starbucks'
    const coffeeIdx = result.indexOf(coffeeEntry);
    const gymIdx = result.indexOf(gymEntry);
    expect(coffeeIdx).toBeLessThan(gymIdx);
  });

  it('assigns medium confidence for keyword-matched habits', () => {
    const gymHabit = habit('h-gym', 'Workout', 'gym', 'positive');
    const habits = [gymHabit];

    const result = suggestHabitsForTransaction('Planet Fitness', habits, []);

    // 'planet fitness' is in the gym keyword list → keyword match sets confidence to
    // 'medium'. The positive-health boost adds points but does not upgrade confidence
    // beyond what was assigned during keyword matching (only historical matches start
    // at 'high').
    expect(result[0]!.habit.id).toBe('h-gym');
    // Keyword-only match → confidence is 'medium', not 'high'
    expect(result[0]!.confidence).toBe('medium');
  });

  it('prioritises historically associated habits over keyword-only matches', () => {
    const historyHabit = habit('h-hist', 'Meal tracking', 'food');
    const keywordHabit = habit('h-kw', 'Eat out', 'food');
    const habits = [historyHabit, keywordHabit];

    // Simulate two previous transactions at the same merchant associating h-hist
    const history = [
      tx('chipotle', ['h-hist']),
      tx('chipotle', ['h-hist']),
    ];

    const result = suggestHabitsForTransaction('chipotle', habits, history);

    // h-hist scores 100 (historical, first match) + 50 (keyword food) + 20 (negative food boost check skipped, but keyword match still)
    // h-kw scores only 50 (keyword food) + potential boost
    expect(result[0]!.habit.id).toBe('h-hist');
    expect(result[0]!.confidence).toBe('high');
  });

  it('returns low confidence for habits that do not match any keyword', () => {
    const irrelevantHabit = habit('h-irr', 'Read a book', 'education');
    const habits = [irrelevantHabit];

    // 'ATM Withdrawal' has no matching HABIT_KEYWORDS entries
    const result = suggestHabitsForTransaction('ATM Withdrawal', habits, []);

    expect(result[0]!.habit.id).toBe('h-irr');
    expect(result[0]!.confidence).toBe('low');
  });

  it('respects maxSuggestions cap on high/medium confidence entries', () => {
    // Create many habits that all match the gym keyword
    const habits = Array.from({ length: 10 }, (_, i) =>
      habit(`h${i}`, `Gym habit ${i}`, 'gym', 'positive'),
    );

    const result = suggestHabitsForTransaction('Planet Fitness', habits, [], 3);

    const highMedCount = result.filter(
      s => s.confidence === 'high' || s.confidence === 'medium',
    ).length;
    expect(highMedCount).toBeLessThanOrEqual(3);
  });

  it('partial merchant word match boosts historical score', () => {
    const partialHabit = habit('h-partial', 'Fast food', 'fastfood', 'negative');
    const history = [tx('mcdonald', ['h-partial'])];

    // 'mcdonalds' has the common word 'mcdonald' (len > 3) with the history tx
    const result = suggestHabitsForTransaction('mcdonalds', [partialHabit], history);

    expect(result[0]!.habit.id).toBe('h-partial');
    // Historical partial match adds 1 point → total might still be >= low threshold
    expect(result).toHaveLength(1);
  });
});

describe('getTopHabitSuggestions', () => {
  it('returns only high/medium confidence habits', () => {
    const gymHabit = habit('h-gym', 'Workout', 'gym', 'positive');
    const unrelatedHabit = habit('h-irr', 'Read a book', 'education');
    const habits = [gymHabit, unrelatedHabit];

    const top = getTopHabitSuggestions('Planet Fitness', habits, []);

    // Only the gym habit should qualify
    expect(top).toContainEqual(expect.objectContaining({ id: 'h-gym' }));
    expect(top).not.toContainEqual(expect.objectContaining({ id: 'h-irr' }));
  });

  it('returns empty array when no habits qualify', () => {
    const habits = [habit('h1', 'Read', 'education')];
    const top = getTopHabitSuggestions('ATM Withdrawal', habits, []);
    expect(top).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    const habits = Array.from({ length: 10 }, (_, i) =>
      habit(`h${i}`, `Gym habit ${i}`, 'gym', 'positive'),
    );

    const top = getTopHabitSuggestions('Planet Fitness', habits, [], 2);
    expect(top.length).toBeLessThanOrEqual(2);
  });
});
