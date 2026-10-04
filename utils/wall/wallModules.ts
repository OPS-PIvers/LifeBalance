import type { WallLayout, WallModuleKey } from '@/types/schema';
import { WALL_MODULE_KEYS } from './wallSettings';

/**
 * The Week screen's right panel (docs/plans/wall-display-kiosk.md §3
 * "Calendar"): 0–2 distinct modules, top first. Pure so the menu, rotation
 * and Settings agree on the rules.
 */

export const MODULE_TITLES: Record<WallModuleKey, string> = {
  coming: 'Coming up',
  shopping: 'Shopping',
  todos: 'To-dos',
  meals: 'Meals this week',
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

export function removeModule(layout: WallLayout, slot: number): WallLayout {
  return { modules: layout.modules.filter((_, i) => i !== slot) };
}

/**
 * With To-dos or Meals in the panel, Today drops its own "Due today"
 * checklist or dinner line so nothing shows twice.
 */
export function suppressDuplicates(modules: readonly WallModuleKey[]): { showDueToday: boolean; showDinner: boolean } {
  return { showDueToday: !modules.includes('todos'), showDinner: !modules.includes('meals') };
}

/**
 * Auto-rotate: advances the bottom module (or the only one) through the
 * household's starting modules, then every other module, skipping whatever
 * the top slot shows. Today never moves; an empty panel doesn't rotate.
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
