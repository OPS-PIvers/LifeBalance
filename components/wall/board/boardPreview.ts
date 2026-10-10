import type { WallLayout, WallModuleKey } from '@/types/schema';
import { dayModule, withTopModule } from '@/utils/wall/wallModules';
import { WALL_MODULE_KEYS } from '@/utils/wall/wallSettings';

/**
 * The Board layout is a mockup for now (docs: the thread's screenshots):
 * `#/wall?board=1` shows it in place of Week's day column and panel.
 */
function hashParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

export function isBoardPreview(): boolean {
  return hashParams().get('board') === '1';
}

/** `&mods=shopping,due`: pin the panel's modules, for screenshots of each pairing. */
export function boardModulesOverride(): WallLayout | null {
  const raw = hashParams().get('mods');
  if (!raw) return null;
  const modules = raw.split(',').flatMap(k => WALL_MODULE_KEYS.filter(m => m === k));
  return modules.length > 0 ? { modules: modules.slice(0, 2), day: null } : null;
}

const BOTTOM_FALLBACK: readonly WallModuleKey[] = ['due', 'todos', 'shopping', 'meals', 'coming'];

/**
 * The Board's panel has two slots. A Week layout with one panel module gets
 * its day module (Due today by default) as the second, so switching layouts
 * keeps what the family already picked.
 */
export function boardLayout(layout: WallLayout): WallLayout {
  const shown = withTopModule(layout);
  const top = shown.modules[0] ?? 'coming';
  const day = dayModule(shown);
  const bottom = shown.modules[1] ?? (day && day !== top ? day : BOTTOM_FALLBACK.find(k => k !== top));
  return { ...shown, modules: bottom ? [top, bottom] : [top], day: null };
}

