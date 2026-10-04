import React from 'react';
import { WifiOff } from 'lucide-react';
import { clockText, zonedParts } from '@/utils/wall/wallTime';
import type { OfflineLevel } from '@/utils/wall/wallStatus';
import type { WallWeather } from '@/utils/wall/wallWeather';
import WallHero from './WallHero';
import { WallWeatherIcon } from './WallIcons';

interface WallTopBarProps {
  now: Date;
  timeZone: string;
  weather: WallWeather | null;
  offline: OfflineLevel;
  onWeather: () => void;
  /** View controls on the right (Day · Week · Month, or list buttons). */
  right?: React.ReactNode;
}

/** Top bar on every wall screen (plan §3 "Top bar"). */
const WallTopBar: React.FC<WallTopBarProps> = ({ now, timeZone, weather, offline, onWeather, right }) => {
  const p = zonedParts(now, timeZone);
  return (
    <>
      <header className="top">
        <WallHero big={clockText(p.hour, p.minute)} top={p.weekday} bottom={`${p.monthName} ${p.day}`} />
        {weather && (
          <>
            <span className="vr" />
            <button type="button" className="wxb" onClick={onWeather} aria-label="Five-day forecast">
              <WallHero
                icon={<WallWeatherIcon icon={weather.current.icon} />}
                big={`${weather.current.temp}°`}
                top={`H ${weather.high}°`}
                bottom={`L ${weather.low}°`}
              />
              {weather.blocks.length > 0 && (
                <>
                  <span className="vr" style={{ margin: 0 }} />
                  <span>
                    <span className="blocks">
                      {weather.blocks.map(b => (
                        <span className="b" key={b.label}>
                          {b.label}
                          <WallWeatherIcon icon={b.icon} />
                          <b>{b.temp}°</b>
                        </span>
                      ))}
                    </span>
                    {weather.rainNote && <span className="rainnote">{weather.rainNote}</span>}
                  </span>
                </>
              )}
            </button>
          </>
        )}
        <div className="right">{right}</div>
      </header>
      {offline === 'strip' && (
        <div className="ostrip" role="status">
          <WifiOff className="wi" size="1em" aria-hidden="true" />
          Offline for a while. Showing what was saved; changes will sync when the connection is back.
        </div>
      )}
    </>
  );
};

export default WallTopBar;
