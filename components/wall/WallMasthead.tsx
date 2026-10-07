import React from 'react';
import type { WallEvent } from '@/types/schema';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import type { WallPeople } from '@/utils/wall/wallPeople';
import type { WallWeather } from '@/utils/wall/wallWeather';
import WallUntimedLine from './calendar/WallUntimedLine';
import { WallWeatherIcon } from './WallIcons';

interface WallMastheadProps {
  now: Date;
  timeZone: string;
  weather: WallWeather | null;
  onWeather: () => void;
  /** Today's all-day events, bills and holidays. */
  untimed: readonly WallEvent[];
  people: WallPeople;
}

/** The Week screen's masthead: the clock with the day and date under it, the weather at the right on the date's line, today's untimed line. */
const WallMasthead: React.FC<WallMastheadProps> = ({ now, timeZone, weather, onWeather, untimed, people }) => {
  const p = zonedParts(now, timeZone);
  return (
    <header className="mast">
      <div className="mtop">
        <div className="mtime">
          <span className="clock">{clockText(p.hour, p.minute)}</span>
          <span className="dd">
            <b>{p.weekday}</b>
            <span>
              {p.monthName} {p.day}
            </span>
          </span>
        </div>
        {weather && (
          <button type="button" className="wxl" onClick={onWeather} aria-label="Five-day forecast">
            <WallWeatherIcon icon={weather.current.icon} />
            <b>{weather.current.temp}°</b>
            <span>
              {weather.high}° / {weather.low}°
            </span>
            {weather.rainNote && <em>{weather.rainNote}</em>}
          </button>
        )}
      </div>
      {untimed.length > 0 && <WallUntimedLine events={untimed} people={people} />}
    </header>
  );
};

export default WallMasthead;
