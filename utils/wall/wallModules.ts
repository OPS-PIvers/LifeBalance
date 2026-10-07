import type { WallLayout, WallModuleKey } from '@/types/schema';
import { WALL_MODULE_KEYS } from './wallSettings';

/**
 * The Week screen's right panel (docs/plans/wall-display-kiosk.md §3
 * "Calendar"): a top module and an optional bottom one (a quarter of the
 * panel), distinct, top first. Pure so Arrange mode, rotation and Settings
 * agree on the rules.
 */

export const MODULE_TITLES: Record<WallModuleKey, string> = {
  coming: 'Coming up',
  shopping: 'Shopping',
  todos: 'To-dos',
  meals: 'Dinners',
};

/** Put `key` in `slot`. A key already showing elsewhere is refused (the menu disables it). */
export function switchModule(layout: WallLayout, slot: number, key: WallModuleKey): WallLayout {
  if (slot < 0 || slot >= layout.modules.length) return layout;
  if (layout.modules.some((k, i) => k === key && i !== slot)) return layout;
  const modules = [...layout.modules];
  modules[slot] = key;
  return { modules };
}

export function addModule(layout: WallLayout, key: WallModuleKey): WallLayout {
  if (layout.modules.length >= 2 || layout.modules.includes(key)) return layout;
  return { modules: [...layout.modules, key] };
}

/** Only the bottom module comes out: the panel always shows something on top. */
export function removeModule(layout: WallLayout, slot: number): WallLayout {
  if (slot < 1 || slot >= layout.modules.length) return layout;
  return { modules: layout.modules.filter((_, i) => i !== slot) };
}

/**
 * The panel is never empty. A layout saved before that rule (the old
 * Today-only mode) shows Coming up.
 */
export function withTopModule(layout: WallLayout): WallLayout {
  return layout.modules.length > 0 ? layout : { modules: ['coming'] };
}

/**
 * With To-dos in the panel, Today drops its own "Due today" checklist so it
 * doesn't show twice. Dinner tonight always stays: the panel's Dinners list
 * starts tomorrow.
 */
export function suppressDuplicates(modules: readonly WallModuleKey[]): { showDueToday: boolean } {
  return { showDueToday: !modules.includes('todos') };
}

/**
 * Auto-rotate: advances the bottom module (or the only one) through the
 * household's starting modules, then every other module, skipping whatever
 * the top slot shows. Today never moves.
 */
export function nextRotation(layout: WallLayout, defaultModules: readonly WallModuleKey[]): WallLayout {
  const n = layout.modules.length;
  if (n === 0) return layout;
  const slot = n - 1;
  const current = layout.modules[slot];
  const top = n === 2 ? layout.modules[0] : undefined;
  const order = [...new Set<WallModuleKey>([...defaultModules, ...WALL_MODULE_KEYS])].filter(k => k !== top);
  const at = order.indexOf(current as WallModuleKey);
  const next = order[(at + 1) % order.length];
  if (!next || next === current) return layout;
  const modules = [...layout.modules];
  modules[slot] = next;
  return { modules };
}
