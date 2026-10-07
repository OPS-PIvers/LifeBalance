import React from 'react';
import type { WallWeather } from '@/utils/wall/wallWeather';
import { WallWeatherIcon } from './WallIcons';

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

/** Five-day forecast, opened by tapping the weather (plan §3). */
const WallForecastSheet: React.FC<{ weather: WallWeather; place?: string; onClose: () => void }> = ({ weather, place, onClose }) => (
  <>
    <button type="button" className="scrim" aria-label="Close forecast" onClick={onClose} />
    <section className="fc" role="dialog" aria-label="Five-day forecast">
      <h3>Next 5 days{place ? ` · ${place}` : ''}</h3>
      <div className="days">
        {weather.days.map((d, i) => (
          <div key={d.date}>
            <span className="w">{i === 0 ? 'Today' : WEEKDAY.format(new Date(`${d.date}T12:00:00Z`))}</span>
            <WallWeatherIcon icon={d.icon} />
            <b>{d.high}°</b>
            <small>{d.low}°</small>
            {d.precipMax >= 30 && <small className="rain">{Math.round(d.precipMax)}% rain</small>}
          </div>
        ))}
      </div>
      <p>Forecast from Open-Meteo, updated every 30 minutes.</p>
    </section>
  </>
);

export default WallForecastSheet;
