import { describe, it, expect } from 'vitest';
import type { ModuleKey } from '@/types/schema';
import { MODULE_PRESETS } from './modulePresets';

const ALL_KEYS: ModuleKey[] = ['habits', 'money', 'plan', 'todos', 'meals', 'shopping'];

describe('MODULE_PRESETS', () => {
  it('has unique, non-empty ids', () => {
    const ids = MODULE_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('every preset specifies every ModuleKey explicitly (deterministic apply)', () => {
    for (const preset of MODULE_PRESETS) {
      for (const key of ALL_KEYS) {
        expect(typeof preset.visibility[key]).toBe('boolean');
      }
      expect(Object.keys(preset.visibility).length).toBe(ALL_KEYS.length);
    }
  });

  it('includes an "Everything" preset that enables every module', () => {
    const everything = MODULE_PRESETS.find(p => p.id === 'everything');
    expect(everything).toBeDefined();
    for (const key of ALL_KEYS) {
      expect(everything?.visibility[key]).toBe(true);
    }
  });

  it('includes a "Finance only" preset that enables only money', () => {
    const financeOnly = MODULE_PRESETS.find(p => p.id === 'finance-only');
    expect(financeOnly).toBeDefined();
    expect(financeOnly?.visibility.money).toBe(true);
    for (const key of ALL_KEYS.filter(k => k !== 'money')) {
      expect(financeOnly?.visibility[key]).toBe(false);
    }
  });

  it('every plan sub-tab preset that enables todos/meals/shopping also enables plan', () => {
    for (const preset of MODULE_PRESETS) {
      const subTabsOn = preset.visibility.todos || preset.visibility.meals || preset.visibility.shopping;
      if (subTabsOn) {
        expect(preset.visibility.plan).toBe(true);
      }
    }
  });

  it('has non-empty labels and descriptions', () => {
    for (const preset of MODULE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });
});
