import { describe, it, expect } from 'vitest';
import type { ToDo } from '@/types/schema';
import {
  categoryFilterKey,
  categoryFilterVocabulary,
  describeCategoryFilter,
  isCategoryFilterEntrySelected,
  matchesCategoryFilter,
  parseStoredCategoryFilter,
  pruneCategoryFilter,
  serializeCategoryFilter,
  toggleCategoryFilterEntry,
  type TodoCategoryFilterEntry,
} from './todoCategoryFilter';

const todo = (category?: string): ToDo => ({
  id: 'todo-1',
  text: 'Take out the trash',
  completeByDate: '2026-07-25',
  assignedTo: 'user-1',
  isCompleted: false,
  createdBy: 'user-1',
  createdAt: '2026-07-20T12:00:00.000Z',
  ...(category === undefined ? {} : { category }),
});

describe('categoryFilterKey', () => {
  it('collapses absent, empty, and whitespace-only to null', () => {
    expect(categoryFilterKey(undefined)).toBeNull();
    expect(categoryFilterKey(null)).toBeNull();
    expect(categoryFilterKey('')).toBeNull();
    expect(categoryFilterKey('   ')).toBeNull();
  });

  it('normalizes case and surrounding space', () => {
    expect(categoryFilterKey('  Home ')).toBe('home');
    expect(categoryFilterKey('HOME')).toBe('home');
  });
});

describe('matchesCategoryFilter', () => {
  it('matches everything when the filter is empty', () => {
    expect(matchesCategoryFilter(todo('Home'), [])).toBe(true);
    expect(matchesCategoryFilter(todo(), [])).toBe(true);
  });

  it('matches category names case-insensitively', () => {
    expect(matchesCategoryFilter(todo('Home'), ['home'])).toBe(true);
    expect(matchesCategoryFilter(todo('home'), ['  HOME '])).toBe(true);
    expect(matchesCategoryFilter(todo('Work'), ['Home'])).toBe(false);
  });

  it('matches absent / blank / whitespace-only categories against the null entry', () => {
    expect(matchesCategoryFilter(todo(), [null])).toBe(true);
    expect(matchesCategoryFilter(todo(''), [null])).toBe(true);
    expect(matchesCategoryFilter(todo('   '), [null])).toBe(true);
    expect(matchesCategoryFilter(todo('Home'), [null])).toBe(false);
  });

  it('does not let a name entry match an uncategorized to-do (and vice versa)', () => {
    expect(matchesCategoryFilter(todo(), ['Home'])).toBe(false);
    expect(matchesCategoryFilter(todo('Home'), [null, 'Work'])).toBe(false);
    expect(matchesCategoryFilter(todo('Work'), [null, 'Work'])).toBe(true);
  });

  it('ORs its own entries (a to-do passes if it matches any of them)', () => {
    expect(matchesCategoryFilter(todo('Errands'), ['Home', 'Errands'])).toBe(true);
  });
});

describe('toggleCategoryFilterEntry / isCategoryFilterEntrySelected', () => {
  it('adds an entry, keeping the caller spelling', () => {
    expect(toggleCategoryFilterEntry([], 'Home')).toEqual(['Home']);
  });

  it('removes case-insensitively', () => {
    expect(toggleCategoryFilterEntry(['Home'], 'home')).toEqual([]);
  });

  it('toggles the uncategorized bucket independently of names', () => {
    const withNull = toggleCategoryFilterEntry(['Home'], null);
    expect(withNull).toEqual(['Home', null]);
    expect(isCategoryFilterEntrySelected(withNull, null)).toBe(true);
    expect(toggleCategoryFilterEntry(withNull, null)).toEqual(['Home']);
  });

  it('never mutates the input', () => {
    const filter: TodoCategoryFilterEntry[] = ['Home'];
    toggleCategoryFilterEntry(filter, 'Work');
    expect(filter).toEqual(['Home']);
  });
});

describe('categoryFilterVocabulary', () => {
  it('is the union of the household list and the categories present on to-dos', () => {
    expect(
      categoryFilterVocabulary(['Home', 'Errands'], [todo('Home'), todo('Groceries')]),
    ).toEqual(['Home', 'Errands', 'Groceries']);
  });

  it('keeps the household order, then sorts the task-only extras', () => {
    expect(
      categoryFilterVocabulary(
        ['Zed', 'Alpha'],
        [todo('zulu'), todo('Beta'), todo('apple pie')],
      ),
    ).toEqual(['Zed', 'Alpha', 'apple pie', 'Beta', 'zulu']);
  });

  it('prefers the household spelling when a to-do spells the same category differently', () => {
    expect(categoryFilterVocabulary(['Home'], [todo('  HOME  ')])).toEqual(['Home']);
  });

  it('de-dupes task-only categories case-insensitively, keeping the first spelling', () => {
    expect(categoryFilterVocabulary([], [todo('Groceries'), todo('groceries')])).toEqual([
      'Groceries',
    ]);
  });

  it('excludes absent / blank / whitespace-only categories (they are the Uncategorized bucket)', () => {
    expect(categoryFilterVocabulary([], [todo(), todo(''), todo('   ')])).toEqual([]);
    expect(categoryFilterVocabulary(['', '  '], [])).toEqual([]);
  });

  it('trims the stored spelling of a task-only category', () => {
    expect(categoryFilterVocabulary([], [todo('  Groceries  ')])).toEqual(['Groceries']);
  });

  it('is stable as unrelated tasks come and go', () => {
    const a = categoryFilterVocabulary(['Home'], [todo('Groceries'), todo('Home')]);
    const b = categoryFilterVocabulary(['Home'], [todo('Home'), todo('Groceries')]);
    expect(a).toEqual(b);
  });
});

describe('pruneCategoryFilter', () => {
  it('drops names that left the vocabulary but keeps the uncategorized bucket', () => {
    expect(pruneCategoryFilter(['Home', 'Gone', null], ['Home', 'Work'])).toEqual(['Home', null]);
    expect(pruneCategoryFilter([null], [])).toEqual([null]);
  });

  it('keeps a task-only category when fed the union vocabulary, but drops a deleted one', () => {
    const vocabulary = categoryFilterVocabulary(['Home'], [todo('Groceries')]);
    // "Groceries" exists only on a task (Shortcut-created) — it must survive.
    expect(pruneCategoryFilter(['Home', 'Groceries', 'Gone'], vocabulary)).toEqual([
      'Home',
      'Groceries',
    ]);
  });

  it('compares against the vocabulary case-insensitively', () => {
    expect(pruneCategoryFilter(['home'], ['Home'])).toEqual(['home']);
  });

  it('returns the SAME reference when nothing is dropped (so setState can bail out)', () => {
    const filter: TodoCategoryFilterEntry[] = ['Home', null];
    expect(pruneCategoryFilter(filter, ['Home'])).toBe(filter);
  });
});

describe('parseStoredCategoryFilter', () => {
  it('returns an empty filter for missing / malformed / non-array values', () => {
    expect(parseStoredCategoryFilter(null)).toEqual([]);
    expect(parseStoredCategoryFilter('')).toEqual([]);
    expect(parseStoredCategoryFilter('not json')).toEqual([]);
    expect(parseStoredCategoryFilter('{"a":1}')).toEqual([]);
    expect(parseStoredCategoryFilter('"Home"')).toEqual([]);
  });

  it('keeps strings and the null sentinel, dropping other element types', () => {
    expect(parseStoredCategoryFilter('["Home",null,3,{},true]')).toEqual(['Home', null]);
  });

  it('normalizes blank strings into the null bucket and de-dupes case-insensitively', () => {
    expect(parseStoredCategoryFilter('["  ", null, "Home", "home"]')).toEqual([null, 'Home']);
  });

  it('round-trips through serializeCategoryFilter', () => {
    const filter: TodoCategoryFilterEntry[] = ['Home', null];
    expect(parseStoredCategoryFilter(serializeCategoryFilter(filter))).toEqual(filter);
  });

  it('serializes the uncategorized bucket as JSON null, not a magic string', () => {
    expect(serializeCategoryFilter([null, 'Home'])).toBe('[null,"Home"]');
  });
});

describe('describeCategoryFilter', () => {
  it('returns null when nothing is filtered', () => {
    expect(describeCategoryFilter([], 'Uncategorized')).toBeNull();
  });

  it('names the single selection, using the label for the null bucket', () => {
    expect(describeCategoryFilter(['Home'], 'Uncategorized')).toBe('Home');
    expect(describeCategoryFilter([null], 'Uncategorized')).toBe('Uncategorized');
  });

  it('falls back to a count for multi-selections', () => {
    expect(describeCategoryFilter(['Home', null], 'Uncategorized')).toBe('2');
  });
});
