import React, { useMemo, useRef } from 'react';
import { eventTimeText, groupComingUp, monthName, splitComingUpDay } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';
import { useWholeFill } from '@/components/wall/useWallFit';
import { WallDot } from '@/components/wall/WallAvatar';
import WallUntimedLine from '@/components/wall/calendar/WallUntimedLine';

/** Timed rows a day shows before "+N more". */
const ROWS_PER_DAY = 3;

interface ComingUpModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
  /** Opens Day view on that date. */
  onOpenDay: (date: string) => void;
}

/**
 * The days after today, as many whole days as fit: untimed items in one
 * quiet line under the heading, up to three timed rows with member dots.
 * A tap opens that day.
 */
const ComingUpModule: React.FC<ComingUpModuleProps> = ({ today, timeZone, people, onOpenDay }) => {
  const { wallEvents } = useWallData();
  const days = useMemo(() => groupComingUp(wallEvents, today), [wallEvents, today]);
  const ref = useRef<HTMLDivElement>(null);
  useWholeFill(ref);
  // The box always renders, so the fill keeps watching it when the list goes from empty to full.
  return (
    <div className="fill" ref={ref}>
      {days.length === 0 && <div className="empty">No events in the next 14 days</div>}
      {days.map(day => {
        const { untimed, timed } = splitComingUpDay(day);
        const shown = timed.slice(0, ROWS_PER_DAY);
        const more = timed.length - shown.length;
        return (
          <button key={day.date} type="button" className="cday" onClick={() => onOpenDay(day.date)}>
            <span className="dh">
              <b>{day.rel ?? day.weekday}</b>
              <span>{day.rel ? `${day.weekday} ${day.dayOfMonth}` : `${monthName(Number(day.date.slice(5, 7))).slice(0, 3)} ${day.dayOfMonth}`}</span>
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

export default ComingUpModule;
