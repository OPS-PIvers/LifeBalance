import React, { useMemo, useState } from 'react';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import type { WallLayout, WallModuleKey } from '@/types/schema';
import { MODULE_TITLES, addModule, removeModule, suppressDuplicates, switchModule } from '@/utils/wall/wallModules';
import type { WallPeople } from '@/utils/wall/wallPeople';
import WallToday from './WallToday';
import { useWallPortrait } from '@/components/wall/useWallFit';
import WallModuleMenu, { type ModuleMenuState } from './WallModuleMenu';
import ComingUpModule from './modules/ComingUpModule';
import MealsModule from './modules/MealsModule';
import ShoppingModule from './modules/ShoppingModule';
import TodosModule from './modules/TodosModule';

interface WallWeekProps {
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  /** What the panel shows right now (the saved layout, or a rotation step). */
  layout: WallLayout;
  onLayout: (layout: WallLayout) => void;
  onSeeMonth: () => void;
  onOpenMeal?: (date: string) => void;
}

/**
 * The resting screen (plan §3 "Week"): Today on the left, up to two stacked
 * modules on the right. Two modules fit to content, the top capped at 60%.
 * In portrait, Today sits on top and the modules share the bottom side by side.
 */
const WallWeek: React.FC<WallWeekProps> = ({ today, now, timeZone, people, layout, onLayout, onSeeMonth, onOpenMeal }) => {
  const [menu, setMenu] = useState<ModuleMenuState | null>(null);
  const { modules } = layout;
  const { showDueToday, showDinner } = useMemo(() => suppressDuplicates(modules), [modules]);
  const solo = modules.length === 0;
  // Portrait stacks Today above the modules (wall.css), sized by its content.
  const portrait = useWallPortrait();

  const body = (key: WallModuleKey) => {
    switch (key) {
      case 'coming':
        return <ComingUpModule today={today} timeZone={timeZone} people={people} onSeeMonth={onSeeMonth} />;
      case 'shopping':
        return <ShoppingModule />;
      case 'todos':
        return <TodosModule today={today} timeZone={timeZone} people={people} />;
      case 'meals':
        return <MealsModule today={today} {...(onOpenMeal ? { onOpenMeal } : {})} />;
    }
  };

  const pick = (key: WallModuleKey) => {
    if (!menu) return;
    onLayout(menu.kind === 'add' ? addModule(layout, key) : switchModule(layout, menu.slot, key));
    setMenu(null);
  };

  return (
    <div className={solo ? 'wk solo' : 'wk'}>
      <WallToday
        today={today}
        now={now}
        timeZone={timeZone}
        people={people}
        showDueToday={showDueToday}
        showDinner={showDinner}
        solo={solo}
        stacked={portrait && !solo}
        onAddModule={() => setMenu({ kind: 'add' })}
      />
      {!solo && (
        <div className={`panel n${modules.length}`}>
          {modules.map((key, slot) => (
            <section className="mod" key={key} aria-label={MODULE_TITLES[key]}>
              <div className="mh">
                <b>{MODULE_TITLES[key]}</b>
                <button type="button" className="sw" onClick={() => setMenu({ kind: 'switch', slot })}>
                  Switch
                  <ChevronsUpDown className="wi" size="1em" aria-hidden="true" />
                </button>
                <button type="button" className="x" aria-label={`Remove ${MODULE_TITLES[key]}`} onClick={() => onLayout(removeModule(layout, slot))}>
                  <X className="wi" size="1em" aria-hidden="true" />
                </button>
              </div>
              <div className="mb">{body(key)}</div>
              {modules.length === 1 && (
                <button type="button" className="addmod" onClick={() => setMenu({ kind: 'add' })}>
                  <Plus className="wi" size="1em" aria-hidden="true" />
                  Add module
                </button>
              )}
            </section>
          ))}
        </div>
      )}
      {menu && <WallModuleMenu menu={menu} modules={modules} onPick={pick} onClose={() => setMenu(null)} />}
    </div>
  );
};

export default WallWeek;
