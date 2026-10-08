import React, { useMemo, useState } from 'react';
import { ChevronsUpDown, Plus, X } from 'lucide-react';
import type { WallLayout, WallModuleKey } from '@/types/schema';
import {
  MODULE_TITLES,
  addModule,
  autoScrolls,
  dayModule,
  removeModule,
  setAutoScroll,
  setDayModule,
  swipeModule,
  switchModule,
  withTopModule,
  type ModulePlace,
} from '@/utils/wall/wallModules';
import { dueTodayChecklist } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import WallToday from './WallToday';
import WallDueToday from './WallDueToday';
import WallModuleMenu, { type ModuleMenuState } from './WallModuleMenu';
import WallModuleSlot from './WallModuleSlot';
import { ModuleScrollContext } from './modules/moduleScroll';
import ComingUpModule, { type ComingUpRange } from './modules/ComingUpModule';
import DueModule from './modules/DueModule';
import MealsModule from './modules/MealsModule';
import ShoppingModule from './modules/ShoppingModule';
import TodosModule from './modules/TodosModule';

const noop = () => undefined;

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
 * quarter of its height; the day column has one optional module under today's
 * events (Due today by default). Coming up carries its own Week · Month switch
 * in its heading, since that's the only thing it changes. A sideways swipe
 * on any module switches what that slot shows, and a long list's heading
 * carries a pause / play for its auto scroll; Switch / Remove / Add stay in
 * Arrange mode. Portrait keeps the same structure, narrower.
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
  // The slot just swiped, so its new module slides in from the side the finger went.
  const [entered, setEntered] = useState<{ place: ModulePlace; dir: 1 | -1 } | null>(null);
  // Back to Week on idle: WallApp remounts this screen.
  const [range, setRange] = useState<ComingUpRange>('week');
  const shown = useMemo(() => withTopModule(layout), [layout]);
  const { modules } = shown;
  const day = dayModule(shown);
  const { todos } = useWallData();
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);

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
      case 'due':
        return <DueModule today={today} timeZone={timeZone} people={people} />;
    }
  };

  /** What a module's heading carries beside its title when not arranging. */
  const headExtra = (key: WallModuleKey) => {
    switch (key) {
      case 'coming':
        return (
          <div className="mseg" role="group" aria-label="Coming up range">
            {RANGES.map(r => (
              <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
        );
      case 'meals':
        return <span>next few nights</span>;
      case 'due':
        return due.length > 0 ? <span>{due.filter(t => t.isCompleted).length} of {due.length} done</span> : null;
      default:
        return null;
    }
  };

  const pick = (key: WallModuleKey) => {
    if (!menu) return;
    if (menu.kind === 'day') onLayout(setDayModule(shown, key));
    else onLayout(menu.kind === 'add' ? addModule(shown, key) : switchModule(shown, menu.slot, key));
    setMenu(null);
  };

  const swipe = (place: ModulePlace, dir: 1 | -1) => {
    const next = swipeModule(shown, place, dir);
    if (next === shown) return;
    setEntered({ place, dir });
    onLayout(next);
  };

  /** A module outside Arrange mode: swipeable, with its auto scroll control. */
  const slot = (key: WallModuleKey, place: ModulePlace, className: string, content: React.ReactNode, bare = false) => (
    <WallModuleSlot
      key={key}
      className={className}
      title={MODULE_TITLES[key]}
      extra={headExtra(key)}
      bare={bare}
      scrollOn={autoScrolls(shown, key)}
      onScroll={on => onLayout(setAutoScroll(shown, key, on))}
      onSwipe={dir => swipe(place, dir)}
      swipeable
      enter={entered?.place === place ? entered.dir : null}
    >
      {content}
    </WallModuleSlot>
  );

  /** A module's list in Arrange mode: it keeps its saved auto scroll; only the chrome changes. */
  const arranged = (key: WallModuleKey) => (
    <ModuleScrollContext.Provider value={{ on: autoScrolls(shown, key), onOverflow: noop }}>{body(key)}</ModuleScrollContext.Provider>
  );

  // Under today's events. Due today is part of the column (sized by its fit);
  // any other module gets a fixed slot at the column's foot, like the panel's bottom.
  let bottom: React.ReactNode = null;
  if (arranging) {
    bottom = day ? (
      <section className={day === 'due' ? 'mod dslot natural' : 'mod dslot'} aria-label={`Under today: ${MODULE_TITLES[day]}`}>
        <div className="mh">
          <b>{MODULE_TITLES[day]}</b>
          <button type="button" className="btn sm" onClick={() => setMenu({ kind: 'day' })}>
            Switch
            <ChevronsUpDown className="wi" size="1em" aria-hidden="true" />
          </button>
          <button type="button" className="btn sm x" aria-label={`Remove ${MODULE_TITLES[day]} from under today`} onClick={() => onLayout(setDayModule(shown, null))}>
            <X className="wi" size="1em" aria-hidden="true" />
          </button>
        </div>
        <div className="mb">{day === 'due' ? <WallDueToday today={today} timeZone={timeZone} people={people} heading={false} /> : arranged(day)}</div>
      </section>
    ) : (
      <button type="button" className="addmod dslot" onClick={() => setMenu({ kind: 'day' })}>
        <Plus className="wi" size="1em" aria-hidden="true" />
        Add a module under today
      </button>
    );
  } else if (day === 'due') {
    bottom = due.length > 0 ? slot('due', 'day', 'dnat', <WallDueToday today={today} timeZone={timeZone} people={people} />, true) : null;
  } else if (day) {
    bottom = slot(day, 'day', 'mod dslot', body(day));
  }

  return (
    <div className={arranging ? 'wk arranging' : 'wk'}>
      <WallToday
        today={today}
        now={now}
        timeZone={timeZone}
        people={people}
        weather={weather}
        onWeather={onWeather}
        bottom={bottom}
        onOpenDay={() => onOpenDay(today)}
      />
      <div className={`panel n${modules.length}`}>
        {arranging && (
          <div className="abar">
            <b>Arrange modules</b>
            <button type="button" className="btn pri" onClick={onArrangeDone}>
              Done
            </button>
          </div>
        )}
        {modules.map((key, i) => {
          const className = i === 0 ? 'mod top' : 'mod bottom';
          if (!arranging) return slot(key, i, className, body(key));
          return (
            <section className={className} key={key} aria-label={MODULE_TITLES[key]}>
              <div className="mh">
                <b>{MODULE_TITLES[key]}</b>
                <button type="button" className="btn sm" onClick={() => setMenu({ kind: 'switch', slot: i })}>
                  Switch
                  <ChevronsUpDown className="wi" size="1em" aria-hidden="true" />
                </button>
                {i > 0 && (
                  <button type="button" className="btn sm x" aria-label={`Remove ${MODULE_TITLES[key]}`} onClick={() => onLayout(removeModule(shown, i))}>
                    <X className="wi" size="1em" aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="mb">{arranged(key)}</div>
              {i === 0 && <span className="mnote">The top module can be switched but not removed.</span>}
            </section>
          );
        })}
        {arranging && modules.length < 2 && (
          <button type="button" className="addmod" onClick={() => setMenu({ kind: 'add' })}>
            <Plus className="wi" size="1em" aria-hidden="true" />
            Add a bottom module
          </button>
        )}
      </div>
      {menu && <WallModuleMenu menu={menu} modules={modules} day={day} onPick={pick} onClose={() => setMenu(null)} />}
    </div>
  );
};

export default WallWeek;
