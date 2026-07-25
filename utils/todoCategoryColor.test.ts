import { describe, it, expect } from 'vitest';
import { STORE_COLORS, DEFAULT_STORE_COLOR } from '@/data/storeColors';
import { getTodoCategoryColor, UNCATEGORIZED_LABEL } from './todoCategoryColor';

const GRAY = STORE_COLORS[DEFAULT_STORE_COLOR];

describe('getTodoCategoryColor', () => {
  it('returns the Uncategorized gray for undefined, empty, and whitespace-only names', () => {
    expect(getTodoCategoryColor(undefined)).toEqual(GRAY);
    expect(getTodoCategoryColor('')).toEqual(GRAY);
    expect(getTodoCategoryColor('   ')).toEqual(GRAY);
    expect(getTodoCategoryColor('\t\n ')).toEqual(GRAY);
  });

  it('is deterministic — the same name always yields the same color', () => {
    const first = getTodoCategoryColor('Home');
    const second = getTodoCategoryColor('Home');
    expect(second).toEqual(first);
    // Repeat a few times to catch any accidental statefulness.
    for (let i = 0; i < 5; i++) {
      expect(getTodoCategoryColor('Home')).toEqual(first);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    const base = getTodoCategoryColor('Home');
    expect(getTodoCategoryColor('home')).toEqual(base);
    expect(getTodoCategoryColor('HOME')).toEqual(base);
    expect(getTodoCategoryColor('  Home  ')).toEqual(base);
  });

  it('never returns the Uncategorized gray for a non-empty name', () => {
    const names = [
      'Home', 'Work', 'Errands', 'Kids', 'Yard', 'Car', 'Finance', 'Health',
      'gray', 'Gray', 'Grey', 'Uncategorized', 'a', 'zzzzzzzzzzzzzzzz',
      'A very long category name that a user might actually type in',
    ];
    for (const name of names) {
      expect(getTodoCategoryColor(name).id).not.toBe(DEFAULT_STORE_COLOR);
    }
  });

  it('spreads distinct common names across more than one color', () => {
    const names = ['Home', 'Work', 'Errands', 'Kids', 'Yard', 'Car', 'Finance', 'Health'];
    const distinct = new Set(names.map(n => getTodoCategoryColor(n).id));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('only ever returns entries that exist in the shared palette', () => {
    const paletteIds = new Set(Object.values(STORE_COLORS).map(c => c.id));
    for (const name of ['Home', 'Work', 'Errands', '', undefined]) {
      expect(paletteIds.has(getTodoCategoryColor(name).id)).toBe(true);
    }
  });
});

describe('UNCATEGORIZED_LABEL', () => {
  it('is the shared display label for the absent case', () => {
    expect(UNCATEGORIZED_LABEL).toBe('Uncategorized');
  });
});
