import type { ModuleKey } from '@/types/schema';

/**
 * Plan F-PLAT-07 — module presets, offered from the "Quick presets" dropdown
 * above the visibility matrix in Settings → Modules & Dashboard → "Who sees
 * what" (they were five wrapping chips above the old "App Modules" toggle list
 * until that section was folded into the matrix). Each preset is a COMPLETE
 * `Record<ModuleKey, boolean>` (every key explicit, not partial) so applying
 * one is deterministic regardless of the household's current shape — no
 * stale `true`s survive from before the tap. Data-driven so adding a new
 * preset is just another array entry; no UI changes required.
 *
 * The matrix's own household switches remain the escape hatch below the
 * dropdown — presets are a starting point, not a lock.
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
      lists: true,
      todos: true,
      meals: true,
      shopping: true,
    },
  },
  {
    id: 'finance-only',
    label: 'Finance only',
    description: 'Just Budget — habits, to-dos, meals, and shopping stay hidden.',
    visibility: {
      habits: false,
      money: true,
      lists: false,
      todos: false,
      meals: false,
      shopping: false,
    },
  },
  {
    id: 'habits-lifestyle',
    label: 'Habits & Lifestyle',
    description: 'Habits only — no Budget, To-Dos, Meals, or Shopping.',
    visibility: {
      habits: true,
      money: false,
      lists: false,
      todos: false,
      meals: false,
      shopping: false,
    },
  },
  {
    id: 'meals-lists',
    label: 'Meals & Lists',
    description: 'Meals and Shopping under Lists — no Budget, Habits, or To-Dos.',
    visibility: {
      habits: false,
      money: false,
      lists: true,
      todos: false,
      meals: true,
      shopping: true,
    },
  },
  {
    id: 'productivity',
    label: 'Productivity',
    description: 'To-Dos under Lists — no Budget, Habits, Meals, or Shopping.',
    visibility: {
      habits: false,
      money: false,
      lists: true,
      todos: true,
      meals: false,
      shopping: false,
    },
  },
];
