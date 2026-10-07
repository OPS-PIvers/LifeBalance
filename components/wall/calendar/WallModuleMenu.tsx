import React from 'react';
import { CalendarCheck, CalendarDays, ListChecks, ShoppingCart, UtensilsCrossed } from 'lucide-react';
import type { WallModuleKey } from '@/types/schema';
import { WALL_MODULE_KEYS } from '@/utils/wall/wallSettings';
import { MODULE_TITLES } from '@/utils/wall/wallModules';

const ICONS: Record<WallModuleKey, typeof CalendarDays> = {
  coming: CalendarDays,
  shopping: ShoppingCart,
  todos: ListChecks,
  meals: UtensilsCrossed,
  due: CalendarCheck,
};

/** A panel slot to switch, the panel's bottom slot to fill, or the day column's slot (under today). */
export type ModuleMenuState = { kind: 'switch'; slot: number } | { kind: 'add' } | { kind: 'day' };

interface WallModuleMenuProps {
  menu: ModuleMenuState;
  modules: readonly WallModuleKey[];
  /** What the day column shows under today, or null. */
  day: WallModuleKey | null;
  onPick: (key: WallModuleKey) => void;
  onClose: () => void;
}

function menuTitle(menu: ModuleMenuState, modules: readonly WallModuleKey[], day: WallModuleKey | null): string {
  if (menu.kind === 'day') return day ? 'Under today shows' : 'Add a module under today';
  if (menu.kind === 'add') return 'Add a bottom module';
  return modules.length === 2 ? (menu.slot === 0 ? 'Top shows' : 'Bottom shows') : 'Panel shows';
}

/** Switch / Add module menu for Arrange mode (the Week panel and the slot under today). */
const WallModuleMenu: React.FC<WallModuleMenuProps> = ({ menu, modules, day, onPick, onClose }) => {
  const title = menuTitle(menu, modules, day);
  const current = menu.kind === 'day' ? day : menu.kind === 'switch' ? modules[menu.slot] : undefined;
  const shown = day ? [...modules, day] : modules;
  const place = menu.kind === 'day' ? 'menu day' : menu.kind === 'add' || (modules.length === 2 && menu.slot === 1) ? 'menu low' : 'menu';
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className={place} role="dialog" aria-label={title}>
        <div className="hd">{title}</div>
        {WALL_MODULE_KEYS.map(key => {
          const Icon = ICONS[key];
          const on = current === key;
          const elsewhere = shown.includes(key) && !on;
          return (
            <button
              key={key}
              type="button"
              className={on ? 'mi on' : 'mi'}
              disabled={elsewhere}
              aria-pressed={on}
              onClick={() => (on ? onClose() : onPick(key))}
            >
              <Icon className="wi" size="1em" strokeWidth={1.75} aria-hidden="true" />
              {MODULE_TITLES[key]}
              {on && <small>Showing</small>}
              {elsewhere && <small>Already showing</small>}
            </button>
          );
        })}
      </div>
    </>
  );
};

export default WallModuleMenu;
