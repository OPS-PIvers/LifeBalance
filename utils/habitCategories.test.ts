import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_HABIT_CATEGORIES,
  MAX_HABIT_CATEGORY_LENGTH,
  UNCATEGORIZED_HABIT_CATEGORY,
  habitCategoryKey,
  habitCategoryVocabulary,
} from './habitCategories';

const h = (category: string) => ({ category });

describe('habitCategoryVocabulary', () => {
  it('returns the stored vocabulary first, then categories only habits use', () => {
    expect(
      habitCategoryVocabulary(['Health', 'Household'], [h('Household'), h('Evening Wind Down')]),
    ).toEqual(['Health', 'Household', 'Evening Wind Down']);
  });

  it('heals the production case: stored list missing categories real habits use', () => {
    // The actual defect this function exists for. The household's stored list
    // held four names while its habits used six, so the two unrecorded ones
    // could not be selected when CREATING a habit — they surfaced only via the
    // "editing habit's own category" fallback, i.e. only while editing a habit
    // already in them.
    const stored = ['Health & Wellbeing', 'Weekly Goals', 'Household', 'Financial Discipline'];
    const habits = [
      h('Health & Wellbeing'),
      h('Household'),
      h('Food & Nutrition'),
      h('Evening Wind Down'),
      h('Financial Discipline'),
      h('Weekly Goals'),
    ];
    expect(habitCategoryVocabulary(stored, habits)).toEqual([
      ...stored,
      'Food & Nutrition',
      'Evening Wind Down',
    ]);
  });

  it('de-duplicates case-insensitively, keeping the FIRST spelling seen', () => {
    // The stored spelling wins over a habit's, so renaming for case in the
    // manager is what changes the chip — not whichever habit loaded first.
    expect(habitCategoryVocabulary(['Health'], [h('health'), h('HEALTH')])).toEqual(['Health']);
  });

  it('keeps a stored category that no habit uses', () => {
    // Deliberate: removing a category is an explicit act in the manage drawer,
    // never a side effect of its last habit leaving.
    expect(habitCategoryVocabulary(['Retired'], [h('Health')])).toEqual(['Retired', 'Health']);
  });

  it('appends `extra` only when it is genuinely new', () => {
    expect(habitCategoryVocabulary(['Health'], [], 'Legacy')).toEqual(['Health', 'Legacy']);
    expect(habitCategoryVocabulary(['Health'], [], 'health')).toEqual(['Health']);
  });

  it('skips blank and whitespace-only categories', () => {
    expect(habitCategoryVocabulary(['', '   '], [h(''), h('  ')], '  ')).toEqual([]);
  });

  it('trims stored values so a padded entry cannot double up', () => {
    expect(habitCategoryVocabulary(['  Health  '], [h('Health')])).toEqual(['Health']);
  });

  it('tolerates undefined inputs and returns EMPTY rather than the defaults', () => {
    // The fallback to DEFAULT_HABIT_CATEGORIES lives in the habit form, not
    // here: the manage drawer must show its empty state instead of listing
    // built-ins whose deletion would do nothing.
    expect(habitCategoryVocabulary(undefined, undefined)).toEqual([]);
    expect(DEFAULT_HABIT_CATEGORIES.length).toBeGreaterThan(0);
  });
});

describe('habitCategoryKey', () => {
  it('trims and lowercases, mapping absent/blank onto the same empty key', () => {
    expect(habitCategoryKey('  Health  ')).toBe('health');
    expect(habitCategoryKey(undefined)).toBe('');
    expect(habitCategoryKey('   ')).toBe('');
  });
});

describe('MAX_HABIT_CATEGORY_LENGTH', () => {
  it('matches the limit firestore.rules enforces on a habit write', () => {
    // 🛡️ Drift guard, not a tautology. The vocabulary ARRAY has no rules limit,
    // so if these two ever disagree a category saves fine, renders as a normal
    // chip, and then makes every habit write that selects it fail
    // permission-denied. If this fails, the rules changed — update the constant,
    // don't relax the test.
    const rules = readFileSync(resolve(__dirname, '..', 'firestore.rules'), 'utf8');
    expect(rules).toContain(
      `isValidString(request.resource.data.get('category', null), ${MAX_HABIT_CATEGORY_LENGTH})`,
    );
  });

  it('admits the fallback category deletion reassigns habits to', () => {
    expect(UNCATEGORIZED_HABIT_CATEGORY.length).toBeLessThanOrEqual(MAX_HABIT_CATEGORY_LENGTH);
    expect(UNCATEGORIZED_HABIT_CATEGORY.trim()).toBe(UNCATEGORIZED_HABIT_CATEGORY);
    expect(UNCATEGORIZED_HABIT_CATEGORY).not.toBe('');
  });
});
