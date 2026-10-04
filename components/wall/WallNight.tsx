import React from 'react';
import type { WallEvent } from '@/types/schema';
import { clockText, wallTimeText, zonedParts } from '@/utils/wall/wallTime';

interface WallNightProps {
  now: Date;
  timeZone: string;
  tomorrowFirst: WallEvent | null;
  onWake: () => void;
}

/** Night screen (plan §3 "Night"): dim clock on black; a tap wakes the wall for 60 s. */
const WallNight: React.FC<WallNightProps> = ({ now, timeZone, tomorrowFirst, onWake }) => {
  const p = zonedParts(now, timeZone);
  let next = '';
  if (tomorrowFirst) {
    if (tomorrowFirst.allDay || !tomorrowFirst.start) {
      next = `Tomorrow · ${tomorrowFirst.title}`;
    } else {
      const s = zonedParts(new Date(tomorrowFirst.start), timeZone);
      next = `Tomorrow ${wallTimeText(s.hour, s.minute)} · ${tomorrowFirst.title}`;
    }
  }
  return (
    <button type="button" className="night" onClick={onWake} aria-label="Wake the display">
      <div>
        <div className="c">{clockText(p.hour, p.minute)}</div>
        <div className="d">
          {p.weekday}, {p.monthName} {p.day}
        </div>
        {next && <div className="n">{next}</div>}
      </div>
    </button>
  );
};

export default WallNight;
