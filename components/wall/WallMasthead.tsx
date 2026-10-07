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

/** The Week screen's masthead: the clock with one short day-and-date line under it, the weather centred beside the pair, today's untimed line. */
const WallMasthead: React.FC<WallMastheadProps> = ({ now, timeZone, weather, onWeather, untimed, people }) => {
  const p = zonedParts(now, timeZone);
  return (
    <header className="mast">
      <div className="mtop">
        <div className="mtime">
          <span className="clock">{clockText(p.hour, p.minute)}</span>
          <span className="dd">
            {p.weekday}, {p.monthName.slice(0, 3)} {p.day}
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
