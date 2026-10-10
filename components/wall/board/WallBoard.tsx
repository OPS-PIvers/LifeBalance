import React, { useMemo } from 'react';
import { Car, ChevronRight } from 'lucide-react';
import type { ToDo, WallEvent } from '@/types/schema';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import { dueTodayChecklist, eventTimeText, groupComingUp, splitComingUpDay, weekdayName, todayFocus, todayTimeline, type TodayRow } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import { WallAvatar, WallDot } from '@/components/wall/WallAvatar';
import { WallWeatherIcon } from '@/components/wall/WallIcons';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';
import './board.css';

/** Days of Coming up the panel lists (only days with something on them). */
const COMING_DAYS = 6;
/** Lanes across the day: Everyone plus up to this many people. */
const MAX_PEOPLE = 4;
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
  onShopping: () => void;
  onTodos: () => void;
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
 * lane per person, and a tinted side panel with the days ahead, who still has
 * to-dos, dinner and the shopping count.
 */
const WallBoard: React.FC<WallBoardProps> = ({ today, now, timeZone, people, weather, onWeather, onOpenDay, onOpenMeal, onShopping, onTodos }) => {
  const { wallEvents, travel, todos, mealPlan, shoppingList } = useWallData();
  const p = zonedParts(now, timeZone);
  const timeline = useMemo(() => todayTimeline(wallEvents, today, now, timeZone), [wallEvents, today, now, timeZone]);
  const focus = useMemo(() => todayFocus(timeline, now), [timeline, now]);
  const coming = useMemo(() => groupComingUp(wallEvents, today, 14).slice(0, COMING_DAYS), [wallEvents, today]);
  const due = useMemo(() => dueTodayChecklist(todos, today, timeZone), [todos, today, timeZone]);

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
    const keys = ['family', ...people.members.slice(0, MAX_PEOPLE).map(m => m.uid)];
    return keys.map(key => ({ key, rows: byOwner.get(key) ?? [] }));
  }, [timeline.rows, people.members]);

  // Due today, per person: unassigned to-dos are anyone's.
  const rings = useMemo(() => {
    const by = new Map<string, ToDo[]>();
    for (const t of due) {
      const key = t.assignedTo ?? 'family';
      by.set(key, [...(by.get(key) ?? []), t]);
    }
    const order = [...people.members.map(m => m.uid), 'family'];
    return order.filter(k => by.has(k)).map(key => {
      const list = by.get(key) ?? [];
      return { key, done: list.filter(t => t.isCompleted).length, total: list.length };
    });
  }, [due, people.members]);

  const dinner = mealPlan.find(m => m.date === today && m.type === 'dinner');
  // The next planned dinner after tonight, so the tile also answers "and tomorrow?".
  const nextDinner = useMemo(() => {
    const later = mealPlan.filter(m => m.type === 'dinner' && m.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!later) return null;
    return { label: weekdayName(later.date).slice(0, 3), name: later.mealName };
  }, [mealPlan, today]);
  const toBuy = shoppingList.filter(i => !i.isPurchased);

  const laneName = (key: string) => (key === 'family' ? 'Everyone' : (people.firstName(key) ?? people.name(key)));

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
          <button type="button" key={lane.key} className="lane" style={{ '--c': people.color(lane.key) } as React.CSSProperties} onClick={() => onOpenDay(today)}>
            <span className="lh">
              <WallAvatar people={people} who={lane.key} small />
              {laneName(lane.key)}
            </span>
            {lane.rows.length === 0 ? (
              <span className="free">Free today</span>
            ) : (
              <LaneRows rows={lane.rows} leadId={lead?.event.id} />
            )}
          </button>
        ))}
      </section>

      <aside className="bdp">
        <section className="pc" aria-label="Coming up">
          <h3>Coming up</h3>
          {coming.length === 0 ? (
            <span className="none">Nothing in the next two weeks</span>
          ) : (
            coming.map(day => {
              const { untimed, timed } = splitComingUpDay(day);
              return (
                <button type="button" key={day.date} className="cr" onClick={() => onOpenDay(day.date)}>
                  <span className="cdh">
                    <b>{day.rel ?? day.weekday}</b>
                    <small>{day.rel ? `${day.weekday} ${day.dayOfMonth}` : day.dayOfMonth}</small>
                  </span>
                  <span className="ce">
                    {timed.slice(0, 2).map(e => (
                      <span key={e.id} className="ci">
                        <WallDot people={people} who={e.ownerKey} />
                        <span className="tm">{eventTimeText(e.start, timeZone)}</span>
                        <span className="tt">{e.title}</span>
                      </span>
                    ))}
                    {untimed.length > 0 && <WallUntimedLine events={untimed} people={people} />}
                  </span>
                </button>
              );
            })
          )}
        </section>

        <button type="button" className="pd" onClick={onTodos}>
          <span className="ph">
            <h3>Due today</h3>
            <small>
              {due.filter(t => t.isCompleted).length} of {due.length} done
            </small>
            <ChevronRight className="wi" size="1em" aria-hidden="true" />
          </span>
          {rings.length === 0 ? (
            <span className="none">Nothing due</span>
          ) : (
            <span className="rings">
              {rings.map(r => (
                <span key={r.key} className="prs" style={{ '--c': people.color(r.key) } as React.CSSProperties}>
                  <Ring done={r.done} total={r.total} />
                  <small>{r.key === 'family' ? 'Anyone' : (people.firstName(r.key) ?? people.name(r.key))}</small>
                </span>
              ))}
            </span>
          )}
        </button>

        <div className="tiles">
          <button type="button" className="tile" onClick={() => onOpenMeal(today)}>
            <small>Dinner tonight</small>
            <b className="meal">{dinner?.mealName ?? 'Not planned'}</b>
            {nextDinner && (
              <span className="nd">
                {nextDinner.label} · {nextDinner.name}
              </span>
            )}
          </button>
          <button type="button" className="tile" onClick={onShopping}>
            <small>Shopping</small>
            <span className="cnt">
              <b>{toBuy.length}</b>
              <span>to buy</span>
            </span>
            <span className="items">
              {toBuy.slice(0, 3).map(i => (
                <span key={i.id}>{i.name}</span>
              ))}
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
};

/** A lane keeps its last finished event (the rest fold into "+N earlier") and up to LANE_AHEAD still to come. */
const LaneRows: React.FC<{ rows: TodayRow[]; leadId: string | undefined }> = ({ rows, leadId }) => {
  const past = rows.filter(r => r.past);
  const ahead = rows.filter(r => !r.past);
  const shown = [...past.slice(-1), ...ahead.slice(0, LANE_AHEAD)];
  const earlier = past.length - Math.min(1, past.length);
  const more = ahead.length - Math.min(LANE_AHEAD, ahead.length);
  return (
    <>
      {earlier > 0 && <span className="lm">+{earlier} earlier</span>}
      {shown.map(row => (
        <LaneItem key={row.event.id} event={row.event} time={row.time} past={row.past} lead={row.event.id === leadId} />
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

/** A to-do progress ring in the person's color, the count inside. */
const Ring: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const r = 30;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? done / total : 0;
  return (
    <span className={done === total ? 'rg all' : 'rg'}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r={r} className="trk" />
        {done > 0 && <circle cx="36" cy="36" r={r} className="val" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 36 36)" />}
      </svg>
      <b>
        {done}/{total}
      </b>
    </span>
  );
};

export default WallBoard;
