import { describe, it, expect } from 'vitest';
import type { Household, ModuleKey } from '@/types/schema';
import {
  isModuleEnabled,
  isPlanVisible,
  isPlanTabVisible,
  type PlanTab,
} from './moduleVisibility';

/** Build the minimal settings shape the visibility helpers read. */
const settings = (
  moduleVisibility?: Household['moduleVisibility'],
): Pick<Household, 'moduleVisibility'> => ({ moduleVisibility });

const ALL_KEYS: ModuleKey[] = ['habits', 'money', 'plan', 'todos', 'meals', 'shopping'];
const PLAN_TABS: PlanTab[] = ['todos', 'meals', 'shopping'];

describe('isModuleEnabled (fail-open)', () => {
  it('treats null settings as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(null, key)).toBe(true);
    }
  });

  it('treats undefined settings as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(undefined, key)).toBe(true);
    }
  });

  it('treats an absent moduleVisibility field as all enabled (legacy household)', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(settings(undefined), key)).toBe(true);
    }
  });

  it('treats an empty moduleVisibility map as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(settings({}), key)).toBe(true);
    }
  });

  it('treats an absent KEY in a partial map as enabled', () => {
    const s = settings({ money: false });
    expect(isModuleEnabled(s, 'money')).toBe(false);
    // habits is absent from the partial map -> enabled
    expect(isModuleEnabled(s, 'habits')).toBe(true);
  });

  it('honors an explicit false', () => {
    expect(isModuleEnabled(settings({ habits: false }), 'habits')).toBe(false);
  });

  it('honors an explicit true', () => {
    expect(isModuleEnabled(settings({ habits: true }), 'habits')).toBe(true);
  });

  it('returns false only when every key is explicitly off (all-off)', () => {
    const allOff = settings(
      ALL_KEYS.reduce<Partial<Record<ModuleKey, boolean>>>((acc, k) => {
        acc[k] = false;
        return acc;
      }, {}),
    );
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(allOff, key)).toBe(false);
    }
  });
});

describe('isPlanVisible', () => {
  it('is true for a legacy household (absent field)', () => {
    expect(isPlanVisible(settings(undefined))).toBe(true);
  });

  it('is true when plan on and all tabs on', () => {
    expect(isPlanVisible(settings({ plan: true, todos: true, meals: true, shopping: true }))).toBe(true);
  });

  it('is false when plan is off, even if every tab is on', () => {
    expect(isPlanVisible(settings({ plan: false, todos: true, meals: true, shopping: true }))).toBe(false);
  });

  it('is false when plan is on but ALL tabs are off (would be an empty page)', () => {
    expect(isPlanVisible(settings({ plan: true, todos: false, meals: false, shopping: false }))).toBe(false);
  });

  it('is true when plan is on and exactly one tab is on', () => {
    expect(isPlanVisible(settings({ plan: true, todos: false, meals: false, shopping: true }))).toBe(true);
    expect(isPlanVisible(settings({ plan: true, todos: true, meals: false, shopping: false }))).toBe(true);
    expect(isPlanVisible(settings({ plan: true, todos: false, meals: true, shopping: false }))).toBe(true);
  });
});

describe('isPlanTabVisible', () => {
  it('is true for every tab in a legacy household (absent field)', () => {
    for (const tab of PLAN_TABS) {
      expect(isPlanTabVisible(settings(undefined), tab)).toBe(true);
    }
  });

  it('is false for every tab when the plan master toggle is off, even if the tab is on', () => {
    const s = settings({ plan: false, todos: true, meals: true, shopping: true });
    for (const tab of PLAN_TABS) {
      expect(isPlanTabVisible(s, tab)).toBe(false);
    }
  });

  it('gates each tab independently when plan is on', () => {
    const s = settings({ plan: true, todos: true, meals: false, shopping: true });
    expect(isPlanTabVisible(s, 'todos')).toBe(true);
    expect(isPlanTabVisible(s, 'meals')).toBe(false);
    expect(isPlanTabVisible(s, 'shopping')).toBe(true);
  });
});
