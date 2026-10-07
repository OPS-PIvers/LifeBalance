import React from 'react';
import { CalendarDays, ListChecks, ShoppingCart, UtensilsCrossed } from 'lucide-react';
import type { WallModuleKey } from '@/types/schema';
import { WALL_MODULE_KEYS } from '@/utils/wall/wallSettings';
import { MODULE_TITLES } from '@/utils/wall/wallModules';

const ICONS: Record<WallModuleKey, typeof CalendarDays> = {
  coming: CalendarDays,
  shopping: ShoppingCart,
  todos: ListChecks,
  meals: UtensilsCrossed,
};

export type ModuleMenuState = { kind: 'switch'; slot: number } | { kind: 'add' };

interface WallModuleMenuProps {
  menu: ModuleMenuState;
  modules: readonly WallModuleKey[];
  onPick: (key: WallModuleKey) => void;
  onClose: () => void;
}

/** Switch / Add module menu for Arrange mode (the Week panel). */
const WallModuleMenu: React.FC<WallModuleMenuProps> = ({ menu, modules, onPick, onClose }) => {
  const title =
    menu.kind === 'add' ? 'Add a bottom module' : modules.length === 2 ? (menu.slot === 0 ? 'Top shows' : 'Bottom shows') : 'Panel shows';
  const low = menu.kind === 'add' || (modules.length === 2 && menu.slot === 1);
  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className={low ? 'menu low' : 'menu'} role="dialog" aria-label={title}>
        <div className="hd">{title}</div>
        {WALL_MODULE_KEYS.map(key => {
          const Icon = ICONS[key];
          const on = menu.kind === 'switch' && modules[menu.slot] === key;
          const elsewhere = modules.includes(key) && !on;
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
