import type { WallLayout, WallModuleKey } from '@/types/schema';
import { dayModule, withTopModule } from '@/utils/wall/wallModules';
import { WALL_MODULE_KEYS } from '@/utils/wall/wallSettings';

/**
 * Board is the wall's resting screen unless Settings picks Week
 * (`wallSettings.home`). `#/wall?board=1` forces it, and in Test Mode also
 * seeds the fuller fixtures the Board was designed against.
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

const BOTTOM_FALLBACK: readonly WallModuleKey[] = ['shopping', 'meals', 'todos', 'coming'];

/**
 * A Board panel change (a swipe, auto scroll) as the layout to save. The
 * layout is shared with Week, and Board never shows Week's day column, so the
 * saved `day` stays whatever it was (absent stays absent: Week's default).
 */
export function boardLayoutToSave(next: WallLayout, saved: WallLayout): WallLayout {
  const { day: _boardDay, ...rest } = next;
  return saved.day === undefined ? rest : { ...rest, day: saved.day };
}

/**
 * The Board's panel has two slots. A Week layout with one panel module gets
 * its day module as the second, so switching layouts keeps what the family
 * already picked; except Due today, which the Board's lanes already show,
 * so Shopping (or the next free module) takes that slot. A Due today the
 * family swipes into the panel themselves stays.
 */
export function boardLayout(layout: WallLayout): WallLayout {
  const shown = withTopModule(layout);
  const top = shown.modules[0] ?? 'coming';
  const day = dayModule(shown);
  const bottom = shown.modules[1] ?? (day && day !== top && day !== 'due' ? day : BOTTOM_FALLBACK.find(k => k !== top));
  return { ...shown, modules: bottom ? [top, bottom] : [top], day: null };
}

