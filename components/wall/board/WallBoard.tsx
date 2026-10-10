import React, { useMemo, useState } from 'react';
import { Car } from 'lucide-react';
import type { WallEvent, WallLayout, WallModuleKey } from '@/types/schema';
import { MODULE_TITLES, autoScrolls, setAutoScroll, swipeModule } from '@/utils/wall/wallModules';
import { boardLayout } from './boardPreview';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import { dueTodayChecklist, eventTimeText, todayFocus, todayTimeline, type TodayRow } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import { WallAvatar } from '@/components/wall/WallAvatar';
import { WallWeatherIcon } from '@/components/wall/WallIcons';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';
import WallModuleSlot from '@/components/wall/calendar/WallModuleSlot';
import MealsModule from '@/components/wall/calendar/modules/MealsModule';
import ShoppingModule from '@/components/wall/calendar/modules/ShoppingModule';
import { BoardComing, BoardDue, BoardTodos } from './BoardModules';
import './board.css';

/** Lanes across the day: Everyone plus up to this many people. */
const MAX_PEOPLE = 4;
/** The lane key for people past MAX_PEOPLE (and owners who've left). */
const OTHERS = 'others';
/** Upcoming events a lane shows before "+N more". */
const LANE_AHEAD = 4;

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
 * Board (mockup): everything the kitchen needs on one screen, in fixed
 * places. A masthead band (clock, weather now and through the day), the next
 * thing as one bright card with its countdown and leave time, today in one
 * lane per person, and a tinted side panel with two module slots that swipe
 * between the same modules Week's panel has (Due today, To-dos, Shopping,
 * Dinners, Coming up).
 */
const WallBoard: React.FC<WallBoardProps> = ({ today, now, timeZone, people, weather, onWeather, onOpenDay, onOpenMeal, layout, onLayout }) => {
  const { wallEvents, travel, todos, mealPlan, shoppingList } = useWallData();
  const p = zonedParts(now, timeZone);
  const timeline = useMemo(() => todayTimeline(wallEvents, today, now, timeZone), [wallEvents, today, now, timeZone]);
  const focus = useMemo(() => todayFocus(timeline, now), [timeline, now]);

  const lead = focus.lead;
  const leadStart = lead ? Date.parse(lead.event.start ?? '') : NaN;
  const leadEnd = lead?.event.end ? Date.parse(lead.event.end) : NaN;
  const drive = lead ? travel.find(t => t.id === lead.event.id) : undefined;
  const leaveMs = drive?.minutes != null && Number.isFinite(leadStart) ? leadStart - drive.minutes * 60000 - now.getTime() : NaN;

  // One lane per person, in roster order, so everyone is always in the same place; Everyone first.
  const lanes = useMemo(() => {
    const byOwner = new Map<string, TodayRow[]>();
    for (const row of timeline.rows) {
      const key = isFamily(row.event.ownerKey) ? 'family' : (row.event.ownerKey ?? 'family');
      byOwner.set(key, [...(byOwner.get(key) ?? []), row]);
    }
    // Past the cap, the last lane is "Others": everyone left over, plus owners no longer in the household.
    const overflow = people.members.length > MAX_PEOPLE;
    const own = people.members.slice(0, overflow ? MAX_PEOPLE - 1 : MAX_PEOPLE).map(m => m.uid);
    const lanes: { key: string; rows: TodayRow[] }[] = ['family', ...own].map(key => ({ key, rows: byOwner.get(key) ?? [] }));
    const shown = new Set(['family', ...own]);
    const rest = timeline.rows.filter(r => !shown.has(isFamily(r.event.ownerKey) ? 'family' : (r.event.ownerKey ?? 'family')));
    if (overflow || rest.length > 0) lanes.push({ key: OTHERS, rows: rest });
    return lanes;
  }, [timeline.rows, people.members]);

  // The panel's two slots: the saved panel modules, the bottom one filled from Week's day module when there isn't one.
  const board = useMemo(() => boardLayout(layout), [layout]);
  const slots = board.modules;
  const [entered, setEntered] = useState<{ place: number; dir: 1 | -1 } | null>(null);
  const swipe = (place: number, dir: 1 | -1) => {
    const next = swipeModule(board, place, dir);
    if (next === board) return;
    setEntered({ place, dir });
    onLayout(next);
  };
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);
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
      <header className="mast bdm">
        <div className="bdt">
          <span className="clock">{clockText(p.hour, p.minute)}</span>
          <span className="dd">
            {p.weekday}, {p.monthName} {p.day}
          </span>
          {timeline.allDay.length > 0 && <WallUntimedLine events={timeline.allDay} people={people} />}
        </div>
        <button type="button" className="bdd" onClick={() => onOpenMeal(today)}>
          <small>Dinner tonight</small>
          <b>{dinner?.mealName ?? 'Not planned'}</b>
        </button>
        {weather && (
          <button type="button" className="bdw" onClick={onWeather} aria-label="Five-day forecast">
            <span className="now">
              <WallWeatherIcon icon={weather.current.icon} />
              <b>{weather.current.temp}°</b>
              <span className="hl">
                H {weather.high}° · L {weather.low}°
              </span>
            </span>
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

      <section className="bdl" aria-label="Today by person">
        {lanes.map(lane => (
          <button type="button" key={lane.key} className="lane" style={{ '--c': lane.key === OTHERS ? 'var(--faint)' : people.color(lane.key) } as React.CSSProperties} onClick={() => onOpenDay(today)}>
            <span className="lh">
              {lane.key !== OTHERS && <WallAvatar people={people} who={lane.key} small />}
              {laneName(lane.key)}
            </span>
            {lane.rows.length === 0 ? (
              <span className="free">Free today</span>
            ) : (
              <LaneRows rows={lane.rows} leadId={lead?.event.id} {...(lane.key === OTHERS ? { owner: (key: string | undefined) => people.firstName(key) ?? people.name(key) } : {})} />
            )}
          </button>
        ))}
      </section>

      <aside className={`panel bdp n${slots.length}`}>
        {slots.map((key, i) => (
          <WallModuleSlot
            key={key}
            className={i === 0 ? 'mod top' : 'mod bottom'}
            title={MODULE_TITLES[key]}
            extra={headExtra(key)}
            scrollOn={autoScrolls(board, key)}
            onScroll={on => onLayout(setAutoScroll(board, key, on))}
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

export default WallBoard;
