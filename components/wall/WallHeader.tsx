import React from 'react';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { WallWeatherIcon } from './WallIcons';

interface WallHeaderProps {
  title: string;
  /** A short count beside the title ("12 to buy"). */
  meta?: string | undefined;
  now: Date;
  timeZone: string;
  weather: WallWeather | null;
  onWeather: () => void;
  /** That screen's controls (the view picker, Add, Clear). */
  right?: React.ReactNode;
}

/** The slim header on every screen but Week: the title, then the time, the temperature and the actions. */
const WallHeader: React.FC<WallHeaderProps> = ({ title, meta, now, timeZone, weather, onWeather, right }) => {
  const p = zonedParts(now, timeZone);
  return (
    <header className="hdr">
      <h2>{title}</h2>
      {meta && <span className="hmeta">{meta}</span>}
      <span className="hclk">
        <b>{clockText(p.hour, p.minute)}</b>
        {weather && (
          <button type="button" className="hwx" onClick={onWeather} aria-label="Five-day forecast">
            <WallWeatherIcon icon={weather.current.icon} />
            <b>{weather.current.temp}°</b>
          </button>
        )}
      </span>
      {right && <div className="right">{right}</div>}
    </header>
  );
};

export default WallHeader;
