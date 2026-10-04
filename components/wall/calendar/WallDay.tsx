import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Flag, Receipt, X } from 'lucide-react';
import type { WallEvent } from '@/types/schema';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  addDaysTo,
  capDayColumns,
  eventTimeText,
  layoutDayBlocks,
  longDateText,
  outsideDayHours,
  zonedHours,
} from '@/utils/wall/wallCalendar';
import { eventsOn } from '@/utils/wall/wallSelectors';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { useWallData } from '@/components/wall/data/wallData';
import WallDayPanel from './WallDayPanel';

interface WallDayProps {
  date: string;
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  weather: WallWeather | null;
  onDate: (date: string) => void;
  onAddTodo: (date: string) => void;
  onOpenMeal: (date: string) => void;
}

const SPAN = DAY_END_HOUR - DAY_START_HOUR;
const pct = (hours: number) => `${(hours / SPAN) * 100}%`;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;
/** Below this many hours a block is too short for two lines, so title and time share one. */
const ONE_LINE_HOURS = 1.5;
/** Horizontal placement inside the lane: 6px gutters, 4px between side-by-side blocks. */
const place = (col: number, span: number, cols: number) => ({
  left: `calc(6px + (100% - 12px) * ${col / cols})`,
  width: `calc((100% - 12px) * ${span / cols} - 4px)`,
});

/**
 * One mixed timeline, 7 am–10 pm (plan §3 "Day"), beside a panel for the
 * day. Clashing events sit side by side, widen into free columns, and past
 * three columns fold into "+N more". Any block opens the full list of what's
 * happening alongside it, so a squeezed title is never the last word.
 */
const WallDay: React.FC<WallDayProps> = ({ date, today, now, timeZone, people, weather, onDate, onAddTodo, onOpenMeal }) => {
  const { wallEvents } = useWallData();
  const [detail, setDetail] = useState<number | null>(null);
  const laid = useMemo(() => layoutDayBlocks(wallEvents, date, timeZone), [wallEvents, date, timeZone]);
  const { blocks, more } = useMemo(() => capDayColumns(laid), [laid]);
  const allDay = useMemo(() => eventsOn(wallEvents, date).filter(e => e.allDay), [wallEvents, date]);
  const outside = useMemo(() => outsideDayHours(wallEvents, date, timeZone), [wallEvents, date, timeZone]);
  const nowH = date === today ? zonedHours(now.toISOString(), timeZone) - DAY_START_HOUR : null;
  const hours = Array.from({ length: SPAN + 1 }, (_, i) => DAY_START_HOUR + i);
  const timeRange = (e: WallEvent) => `${eventTimeText(e.start, timeZone)}${e.end ? `–${eventTimeText(e.end, timeZone)}` : ''}`;
  const detailEvents = detail === null ? [] : laid.filter(b => b.cluster === detail).map(b => b.event);
  // The cluster's whole stretch, e.g. "4:00–6:00".
  const detailEnd = detailEvents.reduce<string | undefined>((latest, e) => {
    const end = e.end ?? e.start;
    return !latest || (end && Date.parse(end) > Date.parse(latest)) ? end : latest;
  }, undefined);
  const detailSpan = `${eventTimeText(detailEvents[0]?.start, timeZone)}–${eventTimeText(detailEnd, timeZone)}`;
  const goTo = (next: string) => {
    setDetail(null);
    onDate(next);
  };

  return (
    <div className="dv">
      <div className="dvl">
        <div className="daynav">
          <button type="button" className="btn" aria-label="Previous day" onClick={() => goTo(addDaysTo(date, -1))}>
            <ChevronLeft className="wi" size="1em" aria-hidden="true" />
          </button>
          <button type="button" className="btn" aria-label="Next day" onClick={() => goTo(addDaysTo(date, 1))}>
            <ChevronRight className="wi" size="1em" aria-hidden="true" />
          </button>
          <b>{date === today ? 'Today' : longDateText(date)}</b>
          {date !== today && (
            <button type="button" className="btn today-btn" onClick={() => goTo(today)}>
              Today
            </button>
          )}
        </div>
        {(allDay.length > 0 || outside.length > 0) && (
          <div className="dva">
            <div>ALL DAY</div>
            <div className="items">
              {allDay.map(e => (
                <span key={e.id}>
                  {e.source === 'bill' ? (
                    <Receipt className="wi" size="1em" aria-hidden="true" />
                  ) : e.source === 'holiday' ? (
                    <Flag className="wi" size="1em" aria-hidden="true" />
                  ) : (
                    <span className="dot" style={{ background: people.color(e.ownerKey) }} />
                  )}
                  {e.title}
                </span>
              ))}
              {outside.map(e => (
                <span key={e.id}>
                  <span className="dot" style={{ background: people.color(e.ownerKey) }} />
                  {eventTimeText(e.start, timeZone)} {e.title}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="dvg">
          <div className="hrs">
            {hours.map(h => (
              <span key={h} style={{ top: pct(h - DAY_START_HOUR) }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          <div className="lane">
            {hours.map(h => (
              <div key={h} className="hl" style={{ top: pct(h - DAY_START_HOUR) }} />
            ))}
            {blocks.map(b => {
              const color = people.color(b.event.ownerKey);
              const past = nowH !== null && b.top + b.height <= nowH;
              const classes = ['blk', b.height < ONE_LINE_HOURS ? 'short' : '', b.span / b.cols <= 1 / 3 ? 'narrow' : '', past ? 'past' : '']
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={b.event.id}
                  type="button"
                  className={classes}
                  aria-label={`${timeRange(b.event)} ${b.event.title}, ${people.name(b.event.ownerKey)}`}
                  onClick={() => setDetail(b.cluster)}
                  style={{ top: pct(b.top), height: `calc(${pct(b.height)} - 3px)`, ...place(b.col, b.span, b.cols), '--c': color } as React.CSSProperties}
                >
                  <span className="av" aria-hidden="true">
                    {people.initial(b.event.ownerKey)}
                  </span>
                  <span className="bt" aria-hidden="true">
                    <span className="tt">{b.event.title}</span>
                    <span className="tm">{timeRange(b.event)}</span>
                  </span>
                </button>
              );
            })}
            {more.map(m => (
              <button
                key={`more-${m.cluster}-${m.top}`}
                type="button"
                className="blk more"
                onClick={() => setDetail(m.cluster)}
                style={{ top: pct(m.top), height: `calc(${pct(m.height)} - 3px)`, ...place(m.col, 1, m.cols) }}
              >
                +{m.events.length} more
              </button>
            ))}
            {blocks.length === 0 && <div className="empty dempty">No events</div>}
            {nowH !== null && nowH >= 0 && nowH <= SPAN && <div className="nowl" style={{ top: pct(nowH) }} />}
          </div>
        </div>
      </div>
      <WallDayPanel
        date={date}
        today={today}
        timeZone={timeZone}
        people={people}
        weather={weather}
        onAddTodo={onAddTodo}
        onOpenMeal={onOpenMeal}
      />
      {detailEvents.length > 0 && (
        <>
          <button type="button" className="scrim" aria-label="Close" onClick={() => setDetail(null)} />
          <section className="evs" role="dialog" aria-label={detailEvents.length > 1 ? 'Events at the same time' : 'Event'}>
            <div className="evh">
              <b>{detailEvents.length > 1 ? `${detailSpan} · ${detailEvents.length} events` : date === today ? 'Today' : longDateText(date)}</b>
              <button type="button" className="x" aria-label="Close" onClick={() => setDetail(null)}>
                <X className="wi" size="1em" aria-hidden="true" />
              </button>
            </div>
            <ul>
              {detailEvents.map(e => (
                <li key={e.id} style={{ '--c': people.color(e.ownerKey) } as React.CSSProperties}>
                  <span className="tm">{timeRange(e)}</span>
                  <span className="tt">
                    {e.title}
                    <small>
                      <span className="dot" />
                      {people.name(e.ownerKey)}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
};

export default WallDay;
