import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Flag, Receipt } from 'lucide-react';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  addDaysTo,
  eventTimeText,
  layoutDayBlocks,
  longDateText,
  outsideDayHours,
  zonedHours,
} from '@/utils/wall/wallCalendar';
import { dueTodayTodos, eventsOn } from '@/utils/wall/wallSelectors';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';

interface WallDayProps {
  date: string;
  today: string;
  now: Date;
  timeZone: string;
  people: WallPeople;
  onDate: (date: string) => void;
}

const SPAN = DAY_END_HOUR - DAY_START_HOUR;
const pct = (hours: number) => `${(hours / SPAN) * 100}%`;
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'a' : 'p'}`;

/** One mixed timeline, 7 am–10 pm, with an all-day strip (plan §3 "Day"). */
const WallDay: React.FC<WallDayProps> = ({ date, today, now, timeZone, people, onDate }) => {
  const { wallEvents, todos, mealPlan } = useWallData();
  const blocks = useMemo(() => layoutDayBlocks(wallEvents, date, timeZone), [wallEvents, date, timeZone]);
  const allDay = useMemo(() => eventsOn(wallEvents, date).filter(e => e.allDay), [wallEvents, date]);
  const outside = useMemo(() => outsideDayHours(wallEvents, date, timeZone), [wallEvents, date, timeZone]);
  const due = useMemo(
    () => (date === today ? dueTodayTodos(todos, today) : todos.filter(t => !t.isCompleted && t.completeByDate === date)),
    [todos, date, today]
  );
  const dinner = mealPlan.find(m => m.date === date && m.type === 'dinner');
  const nowH = date === today ? zonedHours(now.toISOString(), timeZone) - DAY_START_HOUR : null;
  const hours = Array.from({ length: SPAN + 1 }, (_, i) => DAY_START_HOUR + i);

  return (
    <div className="dv">
      <div className="daynav">
        <button type="button" className="btn" aria-label="Previous day" onClick={() => onDate(addDaysTo(date, -1))}>
          <ChevronLeft className="wi" size="1em" aria-hidden="true" />
        </button>
        <button type="button" className="btn" aria-label="Next day" onClick={() => onDate(addDaysTo(date, 1))}>
          <ChevronRight className="wi" size="1em" aria-hidden="true" />
        </button>
        <b>{date === today ? 'Today' : longDateText(date)}</b>
      </div>
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
          {due.map(t => (
            <span key={t.id}>
              ○ {t.text} · {people.name(t.assignedTo)}
            </span>
          ))}
          {dinner && <span className="dinner">Dinner · {dinner.mealName}</span>}
        </div>
      </div>
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
            const width = b.cols === 1 ? 'calc(62% - 14px)' : `calc((100% - 28px) / ${b.cols} - 6px)`;
            const left = b.cols === 1 ? '14px' : `calc(14px + (100% - 28px) / ${b.cols} * ${b.col})`;
            return (
              <div
                key={b.event.id}
                className={b.height < 1 ? 'blk short' : 'blk'}
                style={{ top: pct(b.top), height: `calc(${pct(b.height)} - 4px)`, left, width, borderColor: color }}
              >
                <span className="av" style={{ background: color }} aria-hidden="true">
                  {people.initial(b.event.ownerKey)}
                </span>
                <span>
                  <span className="tm">
                    {eventTimeText(b.event.start, timeZone)}
                    {b.event.end ? `–${eventTimeText(b.event.end, timeZone)}` : ''}
                  </span>
                  <span className="tt">{b.event.title}</span>
                  <span className="sr-only">{people.name(b.event.ownerKey)}</span>
                </span>
              </div>
            );
          })}
          {blocks.length === 0 && <div className="empty dempty">No events</div>}
          {nowH !== null && nowH >= 0 && nowH <= SPAN && <div className="nowl" style={{ top: pct(nowH) }} />}
        </div>
      </div>
    </div>
  );
};

export default WallDay;
