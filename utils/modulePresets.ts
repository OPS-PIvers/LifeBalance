import type { ModuleKey } from '@/types/schema';

/**
 * Plan F-PLAT-07 — one-tap module presets shown above the per-module toggle
 * list in Settings → App Modules. Each preset is a COMPLETE
 * `Record<ModuleKey, boolean>` (every key explicit, not partial) so applying
 * one is deterministic regardless of the household's current shape — no
 * stale `true`s survive from before the tap. Data-driven so adding a new
 * preset is just another array entry; no UI changes required.
 *
 * Manual per-module toggles remain the escape hatch below the preset row —
 * presets are a starting point, not a lock.
 */
export interface ModulePreset {
  /** Stable key for tests/analytics; not shown in the UI. */
  id: string;
  label: string;
  description: string;
  visibility: Record<ModuleKey, boolean>;
}

export const MODULE_PRESETS: ModulePreset[] = [
  {
    id: 'everything',
    label: 'Everything',
    description: 'Turn on every page and tab.',
    visibility: {
      habits: true,
      money: true,
      plan: true,
      todos: true,
      meals: true,
      shopping: true,
    },
  },
  {
    id: 'finance-only',
    label: 'Finance only',
    description: 'Just Money — habits, to-dos, meals, and shopping stay hidden.',
    visibility: {
      habits: false,
      money: true,
      plan: false,
      todos: false,
      meals: false,
      shopping: false,
    },
  },
  {
    id: 'habits-lifestyle',
    label: 'Habits & Lifestyle',
    description: 'Habits only — no Money, To-Dos, Meals, or Shopping.',
    visibility: {
      habits: true,
      money: false,
      plan: false,
      todos: false,
      meals: false,
      shopping: false,
    },
  },
  {
    id: 'meals-lists',
    label: 'Meals & Lists',
    description: 'Meals and Shopping under Plan — no Money, Habits, or To-Dos.',
    visibility: {
      habits: false,
      money: false,
      plan: true,
      todos: false,
      meals: true,
      shopping: true,
    },
  },
  {
    id: 'productivity',
    label: 'Productivity',
    description: 'To-Dos under Plan — no Money, Habits, Meals, or Shopping.',
    visibility: {
      habits: false,
      money: false,
      plan: true,
      todos: true,
      meals: false,
      shopping: false,
    },
  },
];
