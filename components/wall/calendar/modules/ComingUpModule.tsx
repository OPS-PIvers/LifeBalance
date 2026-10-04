import React, { useMemo } from 'react';
import { Flag, Receipt } from 'lucide-react';
import { eventTimeText, groupComingUp } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { useWallData } from '@/components/wall/data/wallData';

interface ComingUpModuleProps {
  today: string;
  timeZone: string;
  people: WallPeople;
  onSeeMonth: () => void;
}

/** The next 14 days, one event per line, never truncated (plan §3 "Coming up"). */
const ComingUpModule: React.FC<ComingUpModuleProps> = ({ today, timeZone, people, onSeeMonth }) => {
  const { wallEvents } = useWallData();
  const days = useMemo(() => groupComingUp(wallEvents, today), [wallEvents, today]);
  if (days.length === 0) return <div className="empty">No events in the next 14 days</div>;
  return (
    <>
      {days.map(day => (
        <div className="grp" key={day.date}>
          <div className="gh">
            <span className="wd">{day.weekday}</span>
            <span className="dn">{day.dayOfMonth}</span>
            {day.rel && <span className="rel">{day.rel}</span>}
          </div>
          <ul>
            {day.muted.map(e => (
              <li key={e.id} className="muted">
                <span />
                <span>
                  {e.source === 'bill' ? (
                    <Receipt className="wi" size="1em" aria-hidden="true" />
                  ) : (
                    <Flag className="wi" size="1em" aria-hidden="true" />
                  )}
                  {e.title}
                </span>
              </li>
            ))}
            {day.events.map(e => (
              <li key={e.id}>
                <span className="tm">{e.allDay ? '' : eventTimeText(e.start, timeZone)}</span>
                <span>
                  <span className="dot" style={{ background: people.color(e.ownerKey) }} />
                  {e.title}
                  <span className="nm">{people.name(e.ownerKey)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button type="button" className="more-link" onClick={onSeeMonth}>
        See the month →
      </button>
    </>
  );
};

export default ComingUpModule;
