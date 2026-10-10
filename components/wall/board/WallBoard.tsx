import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Car, Check, Utensils } from 'lucide-react';
import type { ToDo, WallEvent, WallLayout, WallModuleKey } from '@/types/schema';
import { MODULE_TITLES, autoScrolls, setAutoScroll, swipeModule } from '@/utils/wall/wallModules';
import { boardLayout, boardLayoutToSave } from './boardPreview';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import { DEFAULT_EVENT_MS, dueTodayChecklist, eventTimeText, todayFocus, todayTimeline, type TodayRow } from '@/utils/wall/wallCalendar';
import { subtaskProgress } from '@/utils/subtasks';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import { WallAvatar } from '@/components/wall/WallAvatar';
import { WallWeatherIcon } from '@/components/wall/WallIcons';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';
import WallModuleSlot from '@/components/wall/calendar/WallModuleSlot';
import MealsModule from '@/components/wall/calendar/modules/MealsModule';
import ShoppingModule from '@/components/wall/calendar/modules/ShoppingModule';
import { useWallListActions } from '@/components/wall/lists/useWallListActions';
import { BoardComing, BoardDue, BoardTodos } from './BoardModules';
import { BOARD_OTHERS as OTHERS, boardLanes } from './boardLanes';
import './board.css';

/** Upcoming events a lane shows before "+N more" (the lane's to-dos sit under them). */
const LANE_AHEAD = 3;

interface WallBoardProps {
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  weather: WallWeather | null;
  onWeather: () => void;
  onOpenDay: (date: string) => void;
  onOpenMeal: (date: string) => void;
  /** What the panel shows: the saved layout (or a rotation step). */
  layout: WallLayout;
  onLayout: (layout: WallLayout) => void;
}

/** The hero's big figure: minutes under 100, else hours to the half. */
function countdown(ms: number): { n: string; unit: string } {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min < 100) return { n: String(min), unit: 'min' };
  const halves = Math.round(min / 30);
  return { n: `${Math.floor(halves / 2)}${halves % 2 ? '½' : ''}`, unit: 'hr' };
}

const isFamily = (key: string | undefined) => !key || key === 'family';

/**
 * Board: everything the kitchen needs on one screen, in fixed places. A
 * masthead band (clock; dinner tonight and the weather now as a matched pair
 * of columns; the rest of the day's weather), the next thing as one bright
 * card with its countdown and leave time, today in one lane per person with
 * that person's to-dos under their events (unassigned ones under Everyone),
 * and a tinted side panel with two module slots that swipe between the same
 * modules Week's panel has.
 */
const WallBoard: React.FC<WallBoardProps> = ({ today, now, timeZone, people, weather, onWeather, onOpenDay, onOpenMeal, layout, onLayout }) => {
  const { wallEvents, travel, todos, mealPlan, shoppingList } = useWallData();
  const p = zonedParts(now, timeZone);
  const timeline = useMemo(() => todayTimeline(wallEvents, today, now, timeZone), [wallEvents, today, now, timeZone]);
  const focus = useMemo(() => todayFocus(timeline, now), [timeline, now]);

  const lead = focus.lead;
  const leadStart = lead ? Date.parse(lead.event.start ?? '') : NaN;
  // No end time: it runs for an hour, as todayFocus counts it, so the countdown agrees with "Now".
  const leadEnd = lead?.event.end ? Date.parse(lead.event.end) : leadStart + DEFAULT_EVENT_MS;
  const drive = lead ? travel.find(t => t.id === lead.event.id) : undefined;
  const leaveMs = drive?.minutes != null && Number.isFinite(leadStart) ? leadStart - drive.minutes * 60000 - now.getTime() : NaN;

  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);
  const lanes = useMemo(() => boardLanes(timeline.rows, due, people.members.map(m => m.uid)), [timeline.rows, due, people.members]);
  // Only household to-dos today: they spread across under every lane rather than stacking in Everyone's narrow column.
  const householdOnly = lanes.length > 1 && (lanes[0]?.todos.length ?? 0) > 0 && lanes.slice(1).every(l => l.todos.length === 0);

  // The panel's two slots: the saved panel modules, the bottom one filled from Week's day module when there isn't one.
  const board = useMemo(() => boardLayout(layout), [layout]);
  const slots = board.modules;
  const [entered, setEntered] = useState<{ place: number; dir: 1 | -1 } | null>(null);
  const swipe = (place: number, dir: 1 | -1) => {
    const next = swipeModule(board, place, dir);
    if (next === board) return;
    setEntered({ place, dir });
    onLayout(boardLayoutToSave(next, layout));
  };
  const toBuy = shoppingList.filter(i => !i.isPurchased).length;
  const dinner = mealPlan.find(m => m.date === today && m.type === 'dinner');

  const body = (key: WallModuleKey) => {
    switch (key) {
      case 'coming':
        return <BoardComing today={today} timeZone={timeZone} people={people} onOpenDay={onOpenDay} />;
      case 'due':
        return <BoardDue today={today} timeZone={timeZone} people={people} />;
      case 'todos':
        return <BoardTodos today={today} timeZone={timeZone} people={people} />;
      case 'shopping':
        return <ShoppingModule />;
      case 'meals':
        return <MealsModule today={today} onOpenMeal={onOpenMeal} />;
    }
  };
  const headExtra = (key: WallModuleKey) => {
    switch (key) {
      case 'due':
        return due.length > 0 ? <span>{due.filter(t => t.isCompleted).length} of {due.length} done</span> : null;
      case 'shopping':
        return <span>{toBuy} to buy</span>;
      case 'meals':
        return <span>next few nights</span>;
      default:
        return null;
    }
  };

  const laneName = (key: string) => (key === OTHERS ? 'Others' : key === 'family' ? 'Everyone' : (people.firstName(key) ?? people.name(key)));

  return (
    <div className="bd">
      <header className={weather ? 'mast bdm' : 'mast bdm nowx'}>
        <div className="bdt">
          <span className="clock">{clockText(p.hour, p.minute)}</span>
          <span className="dd">
            {p.weekday}, {p.monthName} {p.day}
          </span>
          {timeline.allDay.length > 0 && <WallUntimedLine events={timeline.allDay} people={people} />}
        </div>
        <button type="button" className="mc dn" onClick={() => onOpenMeal(today)}>
          <span className="tv">
            <Utensils className="wi" size="1em" aria-hidden="true" />
            <b>{dinner?.mealName ?? 'Not planned'}</b>
          </span>
          <i>Dinner tonight</i>
        </button>
        {weather && (
          <>
            <button type="button" className="mc wn" onClick={onWeather} aria-label={`${weather.current.temp} degrees, high ${weather.high}, low ${weather.low}. Five-day forecast`}>
              <span className="tv">
                <WallWeatherIcon icon={weather.current.icon} />
                <b>{weather.current.temp}°</b>
              </span>
              <i>
                H {weather.high}° · L {weather.low}°
              </i>
            </button>
            <button type="button" className="bdw" onClick={onWeather} aria-label="Five-day forecast">
              <span className="strip">
                {weather.blocks.map(b => (
                  <span key={b.label} className={b.rainy ? 'wb r' : 'wb'}>
                    <small>{b.label}</small>
                    <WallWeatherIcon icon={b.icon} />
                    <b>{b.temp}°</b>
                  </span>
                ))}
              </span>
              {weather.rainNote && <em>{weather.rainNote}</em>}
            </button>
          </>
        )}
      </header>

      {lead ? (
        <button type="button" className="bdn" onClick={() => onOpenDay(today)}>
          <span className="k">
            {focus.leadIsNow ? 'Now' : 'Next up'}
            <span aria-hidden="true"> · </span>
            {laneName(isFamily(lead.event.ownerKey) ? 'family' : (lead.event.ownerKey ?? 'family'))}
          </span>
          <b className="t">{lead.event.title}</b>
          <span className="w">
            {lead.time}
            {lead.event.end ? `–${eventTimeText(lead.event.end, timeZone)}` : ''}
            {lead.event.location ? ` · ${lead.event.location}` : ''}
          </span>
          {Number.isFinite(leaveMs) && (
            <span className={leaveMs <= 0 ? 'go now' : 'go'}>
              <Car className="wi" size="1em" aria-hidden="true" />
              {leaveMs <= 0 ? 'Time to leave' : `Leave in ${Math.ceil(leaveMs / 60000)} min`}
              {drive?.minutes != null ? <span className="dm">· {drive.minutes} min drive</span> : null}
            </span>
          )}
          <span className="cd" aria-hidden="true">
            {(() => {
              const c = countdown(focus.leadIsNow && Number.isFinite(leadEnd) ? leadEnd - now.getTime() : leadStart - now.getTime());
              return (
                <>
                  <b>{c.n}</b>
                  <small>{focus.leadIsNow ? `${c.unit} left` : c.unit}</small>
                </>
              );
            })()}
          </span>
        </button>
      ) : (
        <div className="bdn quiet">
          <span className="k">Today</span>
          <b className="t">{timeline.rows.length > 0 ? 'Nothing else today' : 'A free day'}</b>
        </div>
      )}

      <section className="bdl" aria-label="Today by person" style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(0, 1fr))` }}>
        {lanes.map((lane, i) => {
          // A lane's name, events and to-dos are each the lanes grid's own
          // items in its column, so every lane's rows line up (see board.css).
          const col = { '--c': lane.key === OTHERS ? 'var(--faint)' : people.color(lane.key), gridColumn: i + 1 } as React.CSSProperties;
          return (
            <React.Fragment key={lane.key}>
              <span className="lh" style={col}>
                {lane.key !== OTHERS && <WallAvatar people={people} who={lane.key} small />}
                {laneName(lane.key)}
              </span>
              <button type="button" className="lev" style={col} onClick={() => onOpenDay(today)} aria-label={`${laneName(lane.key)}'s day`}>
                {lane.rows.length === 0 ? (
                  <span className="free">Free today</span>
                ) : (
                  <LaneRows rows={lane.rows} leadId={lead?.event.id} {...(lane.key === OTHERS ? { owner: (key: string | undefined) => people.firstName(key) ?? people.name(key) } : {})} />
                )}
              </button>
              {lane.todos.length > 0 && !householdOnly && <LaneTodos todos={lane.todos} today={today} owner={lane.key === OTHERS ? (key: string | undefined) => people.firstName(key) ?? people.name(key) : undefined} style={col} />}
            </React.Fragment>
          );
        })}
        {householdOnly && <LaneTodos todos={lanes[0]?.todos ?? []} today={today} owner={undefined} across={lanes.length} />}
      </section>

      <aside className={`panel bdp n${slots.length}`}>
        {slots.map((key, i) => (
          <WallModuleSlot
            key={key}
            className={i === 0 ? 'mod top' : 'mod bottom'}
            title={MODULE_TITLES[key]}
            extra={headExtra(key)}
            scrollOn={autoScrolls(board, key)}
            onScroll={on => onLayout(boardLayoutToSave(setAutoScroll(board, key, on), layout))}
            onSwipe={dir => swipe(i, dir)}
            swipeable
            enter={entered?.place === i ? entered.dir : null}
          >
            {body(key)}
          </WallModuleSlot>
        ))}
      </aside>
    </div>
  );
};

/** A lane keeps its last finished event (the rest fold into "+N earlier") and up to LANE_AHEAD still to come. */
const LaneRows: React.FC<{ rows: TodayRow[]; leadId: string | undefined; owner?: (key: string | undefined) => string }> = ({ rows, leadId, owner }) => {
  const past = rows.filter(r => r.past);
  const ahead = rows.filter(r => !r.past);
  const shown = [...past.slice(-1), ...ahead.slice(0, LANE_AHEAD)];
  const earlier = past.length - Math.min(1, past.length);
  const more = ahead.length - Math.min(LANE_AHEAD, ahead.length);
  return (
    <>
      {earlier > 0 && <span className="lm">+{earlier} earlier</span>}
      {shown.map(row => (
        <LaneItem key={row.event.id} event={row.event} time={owner ? `${row.time} · ${owner(row.event.ownerKey)}` : row.time} past={row.past} lead={row.event.id === leadId} />
      ))}
      {more > 0 && <span className="lm">+{more} more</span>}
    </>
  );
};

const LaneItem: React.FC<{ event: WallEvent; time: string; past: boolean; lead: boolean }> = ({ event, time, past, lead }) => (
  <span className={['li', past ? 'past' : '', lead ? 'lead' : ''].filter(Boolean).join(' ')}>
    <span className="tm">{time}</span>
    <span className="tt">{event.title}</span>
  </span>
);

/**
 * A lane's to-dos for today, under its events: a big checkbox in the lane's
 * color, the wall's usual Undo on every check. Steps show as "n of m steps";
 * they're checked off from the To-dos screen.
 */
const LaneTodos: React.FC<{ todos: ToDo[]; today: string; owner: ((key: string | undefined) => string) | undefined; across?: number; style?: React.CSSProperties }> = ({ todos, today, owner, across, style }) => {
  const act = useWallListActions();
  const done = todos.filter(t => t.isCompleted).length;
  const list = useRef<HTMLDivElement>(null);
  const { fit, more } = useFittingCount(list, todos.length);
  return (
    <section className={across ? 'ltd all' : 'ltd'} aria-label={across ? 'Household to-dos' : 'To-dos'} style={across ? ({ '--c': 'var(--faint)', '--n': across } as React.CSSProperties) : style}>
      <span className="sh">
        <span>{across ? 'To do · Everyone' : 'To do'}</span>
        <span>
          {done} of {todos.length}
        </span>
      </span>
      <div className="ltl" ref={list}>
      {todos.map((t, i) => {
        const steps = t.subtasks?.length ? subtaskProgress(t.subtasks) : null;
        const off = i >= fit;
        return (
          <button type="button" key={t.id} className={['ltk', t.isCompleted ? 'done' : '', off ? 'off' : ''].filter(Boolean).join(' ')} aria-pressed={t.isCompleted} aria-hidden={off || undefined} tabIndex={off ? -1 : undefined} onClick={() => act.toggleTodo(t)}>
            <span className="bx">{t.isCompleted && <Check size="1em" aria-hidden="true" />}</span>
            <span className="tx">
              <b>{t.text}</b>
              {!t.isCompleted && t.completeByDate < today && <small className="late">Overdue</small>}
              {!t.isCompleted && steps && (
                <small>
                  {steps.done} of {steps.total} steps
                </small>
              )}
              {owner && <small>{owner(t.assignedTo)}</small>}
            </span>
          </button>
        );
      })}
        {more && (
          <span className="lm more" style={more}>
            +{todos.length - fit} more on To-dos
          </span>
        )}
      </div>
    </section>
  );
};

export default WallBoard;

/**
 * How many of a list's rows fit whole in its box. When some don't, the last
 * whole one gives up its place to "+N more" (`more` is that place). Every row
 * stays laid out, only hidden past the count, so the count can grow back.
 */
function useFittingCount(ref: React.RefObject<HTMLElement | null>, total: number): { fit: number; more: React.CSSProperties | null } {
  const [state, setState] = useState<{ fit: number; more: React.CSSProperties | null }>({ fit: total, more: null });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const bottom = box.getBoundingClientRect().bottom;
      const rows = [...box.querySelectorAll<HTMLElement>(':scope > .ltk')];
      const whole = rows.findIndex(r => r.getBoundingClientRect().bottom > bottom + 1);
      const fit = whole === -1 ? rows.length : Math.max(0, whole - 1);
      const slot = whole === -1 ? undefined : rows[fit];
      setState({ fit, more: slot ? { top: slot.offsetTop, left: slot.offsetLeft, width: slot.offsetWidth } : null });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref, total]);
  return { fit: Math.min(state.fit, total), more: state.fit < total ? state.more : null };
}
