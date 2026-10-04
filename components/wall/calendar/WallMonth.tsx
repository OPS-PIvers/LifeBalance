import React, { useMemo } from 'react';
import { Flag, Receipt } from 'lucide-react';
import { eventTimeText, longDateText, monthCells } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';

interface WallMonthProps {
  today: string;
  timeZone: string;
  people: WallPeople;
  onOpenDay: (date: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** This month, up to three lines a day; tap a day for Day view (plan §3 "Month"). */
const WallMonth: React.FC<WallMonthProps> = ({ today, timeZone, people, onOpenDay }) => {
  const { wallEvents } = useWallData();
  const cells = useMemo(() => monthCells(today, wallEvents, today), [today, wallEvents]);
  return (
    <div className="mo" style={{ gridTemplateRows: `auto repeat(${cells.length / 7}, minmax(0, 1fr))` }}>
      {WEEKDAYS.map(w => (
        <div className="mh2" key={w}>
          {w}
        </div>
      ))}
      {cells.map(cell => (
        <button
          key={cell.date}
          type="button"
          className={['cell', cell.inMonth ? '' : 'out', cell.isToday ? 'now' : ''].filter(Boolean).join(' ')}
          aria-label={longDateText(cell.date)}
          onClick={() => onOpenDay(cell.date)}
        >
          <span className="n">{cell.dayOfMonth}</span>
          {cell.lines.map(e =>
            e.source === 'bill' || e.source === 'holiday' ? (
              <span key={e.id} className="ml mut">
                {e.source === 'bill' ? (
                  <Receipt className="wi" size="1em" aria-hidden="true" />
                ) : (
                  <Flag className="wi" size="1em" aria-hidden="true" />
                )}
                {e.title}
              </span>
            ) : (
              <span key={e.id} className="ml">
                <span className="dot" style={{ background: people.color(e.ownerKey) }} />
                {!e.allDay && <span className="t">{eventTimeText(e.start, timeZone)}</span>}
                {e.title}
              </span>
            )
          )}
          {cell.more > 0 && <span className="more">+{cell.more} more</span>}
        </button>
      ))}
    </div>
  );
};

export default WallMonth;
