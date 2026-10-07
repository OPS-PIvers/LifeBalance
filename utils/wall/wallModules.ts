import type { WallLayout, WallModuleKey } from '@/types/schema';
import { WALL_MODULE_KEYS } from './wallSettings';

/**
 * The Week screen's modules (docs/plans/wall-display-kiosk.md §3 "Calendar"):
 * the right panel's top module and optional bottom one (a quarter of the
 * panel), plus one optional module under today's events in the day column.
 * All distinct. Pure so Arrange mode, rotation and Settings agree on the rules.
 */

export const MODULE_TITLES: Record<WallModuleKey, string> = {
  coming: 'Coming up',
  shopping: 'Shopping',
  todos: 'To-dos',
  meals: 'Dinners',
  due: 'Due today',
};

/** Rebuilds a layout without writing an `undefined` day (Firestore refuses it). */
function withDay(modules: WallModuleKey[], day: WallLayout['day']): WallLayout {
  return day === undefined ? { modules } : { modules, day };
}

/**
 * What the day column shows under today's events. Absent means the default,
 * Due today, unless the panel already shows it or To-dos (the same items
 * twice); an explicit choice is shown as picked.
 */
export function dayModule(layout: WallLayout): WallModuleKey | null {
  if (layout.day !== undefined) return layout.day;
  return layout.modules.includes('todos') || layout.modules.includes('due') ? null : 'due';
}

/** Every module on screen: the panel's, then the day column's. */
export function shownModules(layout: WallLayout): WallModuleKey[] {
  const day = dayModule(layout);
  return day ? [...layout.modules, day] : [...layout.modules];
}

/** Put `key` under today's events (`null` clears the slot). A key the panel shows is refused. */
export function setDayModule(layout: WallLayout, key: WallModuleKey | null): WallLayout {
  if (key && layout.modules.includes(key)) return layout;
  return { modules: layout.modules, day: key };
}

/** Put `key` in `slot`. A key already showing elsewhere is refused (the menu disables it). */
export function switchModule(layout: WallLayout, slot: number, key: WallModuleKey): WallLayout {
  if (slot < 0 || slot >= layout.modules.length) return layout;
  if (layout.modules.some((k, i) => k === key && i !== slot) || dayModule(layout) === key) return layout;
  const modules = [...layout.modules];
  modules[slot] = key;
  return withDay(modules, layout.day);
}

export function addModule(layout: WallLayout, key: WallModuleKey): WallLayout {
  if (layout.modules.length >= 2 || layout.modules.includes(key) || dayModule(layout) === key) return layout;
  return withDay([...layout.modules, key], layout.day);
}

/** Only the bottom module comes out: the panel always shows something on top. */
export function removeModule(layout: WallLayout, slot: number): WallLayout {
  if (slot < 1 || slot >= layout.modules.length) return layout;
  return withDay(
    layout.modules.filter((_, i) => i !== slot),
    layout.day
  );
}

/**
 * The panel is never empty. A layout saved before that rule (the old
 * Today-only mode) shows Coming up, unless the day column already does.
 */
export function withTopModule(layout: WallLayout): WallLayout {
  if (layout.modules.length > 0) return layout;
  const top: WallModuleKey = layout.day === 'coming' ? 'shopping' : 'coming';
  return withDay([top], layout.day);
}

/**
 * Auto-rotate: advances the bottom module (or the only one) through the
 * household's starting modules, then every other module, skipping whatever
 * the top slot and the day column show. Today never moves. Rotating To-dos
 * in hides the default Due today, as the panel showing To-dos always has.
 */
export function nextRotation(layout: WallLayout, defaultModules: readonly WallModuleKey[]): WallLayout {
  const n = layout.modules.length;
  if (n === 0) return layout;
  const slot = n - 1;
  const current = layout.modules[slot];
  const top = n === 2 ? layout.modules[0] : undefined;
  const day = dayModule(layout);
  const order = [...new Set<WallModuleKey>([...defaultModules, ...WALL_MODULE_KEYS])].filter(k => k !== top && k !== day);
  const at = order.indexOf(current as WallModuleKey);
  const next = order[(at + 1) % order.length];
  if (!next || next === current) return layout;
  const modules = [...layout.modules];
  modules[slot] = next;
  return withDay(modules, layout.day);
}
