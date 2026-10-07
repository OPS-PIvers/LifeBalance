import React, { useMemo, useState } from 'react';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import type { WallLayout, WallModuleKey } from '@/types/schema';
import { MODULE_TITLES, addModule, removeModule, suppressDuplicates, switchModule, withTopModule } from '@/utils/wall/wallModules';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import WallToday from './WallToday';
import WallModuleMenu, { type ModuleMenuState } from './WallModuleMenu';
import ComingUpModule, { type ComingUpRange } from './modules/ComingUpModule';
import MealsModule from './modules/MealsModule';
import ShoppingModule from './modules/ShoppingModule';
import TodosModule from './modules/TodosModule';

const RANGES: { key: ComingUpRange; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

interface WallWeekProps {
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  weather: WallWeather | null;
  onWeather: () => void;
  /** What the panel shows right now (the saved layout, or a rotation step). */
  layout: WallLayout;
  onLayout: (layout: WallLayout) => void;
  onOpenDay: (date: string) => void;
  onOpenMeal?: (date: string) => void;
  /** Arrange mode: the panel's controls show, the day column dims. */
  arranging?: boolean;
  onArrangeDone?: () => void;
}

/**
 * The resting screen (docs/DECISIONS.md "Wall redesign"): the day column,
 * then the panel. The panel has a top module and an optional bottom module a
 * quarter of its height. Coming up carries its own Week · Month switch in its
 * heading, since that's the only thing it changes; the panel shows no editing
 * controls except in Arrange mode. Portrait keeps the same structure, narrower.
 */
const WallWeek: React.FC<WallWeekProps> = ({
  today,
  now,
  timeZone,
  people,
  weather,
  onWeather,
  layout,
  onLayout,
  onOpenDay,
  onOpenMeal,
  arranging = false,
  onArrangeDone,
}) => {
  const [menu, setMenu] = useState<ModuleMenuState | null>(null);
  // Back to Week on idle: WallApp remounts this screen.
  const [range, setRange] = useState<ComingUpRange>('week');
  const shown = useMemo(() => withTopModule(layout), [layout]);
  const { modules } = shown;
  const { showDueToday } = useMemo(() => suppressDuplicates(modules), [modules]);

  const body = (key: WallModuleKey) => {
    switch (key) {
      case 'coming':
        return <ComingUpModule today={today} timeZone={timeZone} people={people} range={range} onOpenDay={onOpenDay} />;
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
    onLayout(menu.kind === 'add' ? addModule(shown, key) : switchModule(shown, menu.slot, key));
    setMenu(null);
  };

  return (
    <div className={arranging ? 'wk arranging' : 'wk'}>
      <WallToday
        today={today}
        now={now}
        timeZone={timeZone}
        people={people}
        weather={weather}
        onWeather={onWeather}
        showDueToday={showDueToday}
        onOpenDay={() => onOpenDay(today)}
      />
      <div className={`panel n${modules.length}`}>
        {arranging && (
          <div className="abar">
            <b>Arrange the panel</b>
            <button type="button" className="btn pri" onClick={onArrangeDone}>
              Done
            </button>
          </div>
        )}
        {modules.map((key, slot) => (
          <section className={slot === 0 ? 'mod top' : 'mod bottom'} key={key} aria-label={MODULE_TITLES[key]}>
            <div className="mh">
              <b>{MODULE_TITLES[key]}</b>
              {arranging ? (
                <>
                  <button type="button" className="btn sm" onClick={() => setMenu({ kind: 'switch', slot })}>
                    Switch
                    <ChevronsUpDown className="wi" size="1em" aria-hidden="true" />
                  </button>
                  {slot > 0 && (
                    <button type="button" className="btn sm x" aria-label={`Remove ${MODULE_TITLES[key]}`} onClick={() => onLayout(removeModule(shown, slot))}>
                      <X className="wi" size="1em" aria-hidden="true" />
                    </button>
                  )}
                </>
              ) : key === 'coming' ? (
                <div className="mseg" role="group" aria-label="Coming up range">
                  {RANGES.map(r => (
                    <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              ) : (
                key === 'meals' && <span>next few nights</span>
              )}
            </div>
            <div className="mb">{body(key)}</div>
            {arranging && slot === 0 && <span className="note">The top module can be switched but not removed.</span>}
          </section>
        ))}
        {arranging && modules.length < 2 && (
          <button type="button" className="addmod" onClick={() => setMenu({ kind: 'add' })}>
            <Plus className="wi" size="1em" aria-hidden="true" />
            Add a bottom module
          </button>
        )}
      </div>
      {menu && <WallModuleMenu menu={menu} modules={modules} onPick={pick} onClose={() => setMenu(null)} />}
    </div>
  );
};

export default WallWeek;
