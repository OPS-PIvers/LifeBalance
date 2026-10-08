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

/**
 * The layout with new panel modules. Spread, so the day slot and auto-scroll
 * choices carry over and an absent day stays absent (Firestore refuses `undefined`).
 */
function withModules(layout: WallLayout, modules: WallModuleKey[]): WallLayout {
  return { ...layout, modules };
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
  return { ...layout, day: key };
}

/** Put `key` in `slot`. A key already showing elsewhere is refused (the menu disables it). */
export function switchModule(layout: WallLayout, slot: number, key: WallModuleKey): WallLayout {
  if (slot < 0 || slot >= layout.modules.length) return layout;
  if (layout.modules.some((k, i) => k === key && i !== slot) || dayModule(layout) === key) return layout;
  const modules = [...layout.modules];
  modules[slot] = key;
  return withModules(layout, modules);
}

export function addModule(layout: WallLayout, key: WallModuleKey): WallLayout {
  if (layout.modules.length >= 2 || layout.modules.includes(key) || dayModule(layout) === key) return layout;
  return withModules(layout, [...layout.modules, key]);
}

/** Only the bottom module comes out: the panel always shows something on top. */
export function removeModule(layout: WallLayout, slot: number): WallLayout {
  if (slot < 1 || slot >= layout.modules.length) return layout;
  return withModules(
    layout,
    layout.modules.filter((_, i) => i !== slot)
  );
}

/**
 * The panel is never empty. A layout saved before that rule (the old
 * Today-only mode) shows Coming up, unless the day column already does.
 */
export function withTopModule(layout: WallLayout): WallLayout {
  if (layout.modules.length > 0) return layout;
  const top: WallModuleKey = layout.day === 'coming' ? 'shopping' : 'coming';
  return withModules(layout, [top]);
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
  return withModules(layout, modules);
}

/** Where a module sits on the Week screen: a panel slot (0 top, 1 bottom) or the day column's slot. */
export type ModulePlace = number | 'day';

/**
 * A swipe on a module: the next (dir 1) or previous (dir -1) module in
 * `WALL_MODULE_KEYS` order, wrapping round, skipping whatever the other slots
 * show. A default day slot (Due today, absent from the saved layout) is pinned
 * first, so swiping the panel through To-dos never makes Due today vanish
 * under today. Unchanged when there's nothing else to show.
 */
export function swipeModule(layout: WallLayout, place: ModulePlace, dir: 1 | -1): WallLayout {
  const pinned: WallLayout = layout.day === undefined ? { ...layout, day: dayModule(layout) } : layout;
  const current = place === 'day' ? pinned.day : pinned.modules[place];
  if (!current) return layout;
  const others = new Set<WallModuleKey>(place === 'day' ? pinned.modules : [...pinned.modules.filter((_, i) => i !== place), ...(pinned.day ? [pinned.day] : [])]);
  const keys = WALL_MODULE_KEYS;
  const at = keys.indexOf(current);
  for (let step = 1; step < keys.length; step++) {
    const next = keys[(((at + dir * step) % keys.length) + keys.length) % keys.length];
    if (!next || others.has(next)) continue;
    if (place === 'day') return { ...pinned, day: next };
    const modules = [...pinned.modules];
    modules[place] = next;
    return { ...pinned, modules };
  }
  return layout;
}

/**
 * Whether a module's list turns by itself when it's longer than its box. The
 * lists (Shopping, To-dos, Due today) do unless stopped; Coming up and Dinners
 * fill whole days unless started, since a cut-off day reads worse than a
 * short list. Started or stopped on the wall itself, or from the phone.
 */
export const DEFAULT_AUTO_SCROLL: Record<WallModuleKey, boolean> = {
  coming: false,
  shopping: true,
  todos: true,
  meals: false,
  due: true,
};

export function autoScrolls(layout: WallLayout, key: WallModuleKey): boolean {
  return layout.scroll?.[key] ?? DEFAULT_AUTO_SCROLL[key];
}

export function setAutoScroll(layout: WallLayout, key: WallModuleKey, on: boolean): WallLayout {
  return { ...layout, scroll: { ...layout.scroll, [key]: on } };
}
