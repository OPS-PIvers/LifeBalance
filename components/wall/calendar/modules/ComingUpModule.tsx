import React, { useMemo, useRef } from 'react';
import { eventTimeText, groupComingUp, monthName, splitComingUpDay } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWholeFill } from '@/components/wall/useWallFit';
import { WallDot } from '@/components/wall/WallAvatar';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';

/** Timed rows a Week day shows before "+N more". */
const ROWS_PER_DAY = 3;
/** How far the Month list reaches. */
const MONTH_DAYS = 30;

/** Week: the next seven days, every one. Month: the next 30 days with something on them. */
export type ComingUpRange = 'week' | 'month';

interface ComingUpModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
  range?: ComingUpRange;
  /** Opens Day view on that date. */
  onOpenDay: (date: string) => void;
}

const shortMonth = (date: string) => monthName(Number(date.slice(5, 7))).slice(0, 3);

/**
 * The days after today (today itself is the day column's). Week shows the
 * next seven days as whole days that fit, a free day as one quiet line;
 * Month is a denser list of the next 30 days that scrolls. A tap opens that day.
 */
const ComingUpModule: React.FC<ComingUpModuleProps> = ({ today, timeZone, people, range = 'week', onOpenDay }) =>
  range === 'month' ? (
    <MonthList today={today} timeZone={timeZone} people={people} onOpenDay={onOpenDay} />
  ) : (
    <WeekList today={today} timeZone={timeZone} people={people} onOpenDay={onOpenDay} />
  );

type ListProps = Omit<ComingUpModuleProps, 'range'>;

const WeekList: React.FC<ListProps> = ({ today, timeZone, people, onOpenDay }) => {
  const { wallEvents } = useWallData();
  const days = useMemo(() => groupComingUp(wallEvents, today, 7, true), [wallEvents, today]);
  const ref = useRef<HTMLDivElement>(null);
  useWholeFill(ref);
  // The box always renders, so the fill keeps watching it when the list changes.
  return (
    <div className="fill" ref={ref}>
      {days.map(day => {
        const { untimed, timed } = splitComingUpDay(day);
        const free = untimed.length === 0 && timed.length === 0;
        const shown = timed.slice(0, ROWS_PER_DAY);
        const more = timed.length - shown.length;
        const tomorrow = day.rel === 'Tomorrow';
        return (
          <button key={day.date} type="button" className={free ? 'cday free' : 'cday'} onClick={() => onOpenDay(day.date)}>
            <span className="dh">
              <b>{tomorrow ? 'Tomorrow' : day.weekday}</b>
              <span>{tomorrow ? `${day.weekday} ${day.dayOfMonth}` : `${shortMonth(day.date)} ${day.dayOfMonth}`}</span>
              {free && <em>Nothing planned</em>}
            </span>
            {untimed.length > 0 && <WallUntimedLine events={untimed} people={people} />}
            {shown.map(e => (
              <span className="r" key={e.id}>
                <span className="tm">{eventTimeText(e.start, timeZone)}</span>
                <span className="t">
                  <WallDot people={people} who={e.ownerKey} />
                  {e.title}
                </span>
              </span>
            ))}
            {more > 0 && <span className="more">+{more} more</span>}
          </button>
        );
      })}
    </div>
  );
};

const MonthList: React.FC<ListProps> = ({ today, timeZone, people, onOpenDay }) => {
  const { wallEvents } = useWallData();
  const days = useMemo(() => groupComingUp(wallEvents, today, MONTH_DAYS), [wallEvents, today]);
  if (days.length === 0) return <div className="empty">Nothing in the next {MONTH_DAYS} days</div>;
  const rows: React.ReactNode[] = [];
  let month = today.slice(0, 7);
  days.forEach(day => {
    // A month heading where the list crosses into the next month.
    if (day.date.slice(0, 7) !== month) {
      month = day.date.slice(0, 7);
      rows.push(
        <div key={`m-${month}`} className="mmon">
          {monthName(Number(month.slice(5, 7)))}
        </div>
      );
    }
    const { untimed, timed } = splitComingUpDay(day);
    rows.push(
      <button key={day.date} type="button" className="mday" onClick={() => onOpenDay(day.date)}>
        <span className="md">
          <small>{day.weekday}</small>
          <b>{day.dayOfMonth}</b>
        </span>
        <span className="me">
          {untimed.length > 0 && <WallUntimedLine events={untimed} people={people} />}
          {timed.map(e => (
            <span className="r" key={e.id}>
              <span className="tm">{eventTimeText(e.start, timeZone)}</span>
              <span className="t">
                <WallDot people={people} who={e.ownerKey} />
                {e.title}
              </span>
            </span>
          ))}
        </span>
      </button>
    );
  });
  return <div className="mlist">{rows}</div>;
};

export default ComingUpModule;
