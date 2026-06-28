import type { Household, ModuleKey } from '@/types/schema';

/**
 * The slice of household settings the module-visibility helpers read. Accepts
 * the full Household, a `Pick`ed shape, or null/undefined (during cold load)
 * — every case fails open to "enabled".
 */
export type ModuleSettings = Pick<Household, 'moduleVisibility'> | null | undefined;

/** A Plan sub-tab key (the toggleable tabs inside the Plan page). */
export type PlanTab = 'todos' | 'meals' | 'shopping';

/**
 * Plan 090 (Modular pages) — the single source of truth for whether a module
 * is enabled. FAIL-OPEN: an absent settings object, an absent `moduleVisibility`
 * map, or an absent key all mean ENABLED. Only an explicit `false` disables a
 * module, so every legacy household (no field) keeps all pages.
 */
export const isModuleEnabled = (settings: ModuleSettings, key: ModuleKey): boolean =>
  settings?.moduleVisibility?.[key] !== false;

/**
 * Whether the Plan footer page (and its `/lists` route) should be visible. The
 * Plan master toggle must be on AND at least one sub-tab must be enabled —
 * otherwise the page would render an empty tab strip, so it auto-hides.
 */
export const isPlanVisible = (settings: ModuleSettings): boolean =>
  isModuleEnabled(settings, 'plan') &&
  (isModuleEnabled(settings, 'todos') ||
    isModuleEnabled(settings, 'meals') ||
    isModuleEnabled(settings, 'shopping'));

/**
 * Whether a specific Plan sub-tab (and its standalone route) is visible. The
 * Plan master toggle gates every sub-tab, so turning Plan off hides all tabs
 * regardless of their individual flags.
 */
export const isPlanTabVisible = (settings: ModuleSettings, tab: PlanTab): boolean =>
  isModuleEnabled(settings, 'plan') && isModuleEnabled(settings, tab);
