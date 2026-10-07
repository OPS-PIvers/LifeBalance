import React from 'react';
import type { WallEvent } from '@/types/schema';
import { eventTimeText } from '@/utils/wall/wallCalendar';
import type { WallPeople } from '@/utils/wall/wallPeople';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import type { WeatherDay } from '@/utils/wall/wallWeather';
import { WallWeatherIcon } from './WallIcons';

interface WallNightProps {
  now: Date;
  timeZone: string;
  /** Tomorrow's first two timed events and its all-day ones (wallSelectors `tomorrowPreview`). */
  tomorrow: { timed: readonly WallEvent[]; allDay: readonly WallEvent[] };
  tomorrowWeather: WeatherDay | undefined;
  people: WallPeople;
  onWake: () => void;
}

/**
 * Night screen: the day's masthead, dimmed near-black on black, with a quiet
 * look at tomorrow. A tap wakes the wall for 60 s.
 */
const WallNight: React.FC<WallNightProps> = ({ now, timeZone, tomorrow, tomorrowWeather, people, onWake }) => {
  const p = zonedParts(now, timeZone);
  const hasTomorrow = tomorrow.timed.length > 0 || tomorrow.allDay.length > 0 || !!tomorrowWeather;
  return (
    <button type="button" className="night" onClick={onWake} aria-label="Wake the display">
      <span className="nin">
        <span className="nmast">
          <span className="c">{clockText(p.hour, p.minute)}</span>
          <span className="d">
            <b>{p.weekday}</b>
            <span>
              {p.monthName} {p.day}
            </span>
          </span>
        </span>
        {hasTomorrow && (
          <span className="ntom">
            <span className="k">Tomorrow</span>
            {tomorrow.timed.map(e => (
              <span className="row" key={e.id}>
                <span className="t">{eventTimeText(e.start, timeZone)}</span>
                <span className="ndot" style={{ background: people.color(e.ownerKey) }} aria-hidden="true" />
                {e.title}
              </span>
            ))}
            {(tomorrowWeather || tomorrow.allDay.length > 0) && (
              <span className="wx">
                {tomorrowWeather && (
                  <>
                    <WallWeatherIcon icon={tomorrowWeather.icon} />
                    {tomorrowWeather.high}° / {tomorrowWeather.low}°
                  </>
                )}
                {tomorrowWeather && tomorrow.allDay.length > 0 && ' · '}
                {tomorrow.allDay.map(e => e.title).join(' · ')}
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  );
};

export default WallNight;
