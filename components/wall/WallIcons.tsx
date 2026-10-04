import React from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import type { WeatherIcon } from '@/utils/wall/wallWeather';

const ICONS = {
  sun: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
} as const;

/** Weather glyph sized by the surrounding font-size; rainy kinds get the rain color. */
export const WallWeatherIcon: React.FC<{ icon: WeatherIcon }> = ({ icon }) => {
  const Icon = ICONS[icon];
  const rainy = icon === 'rain' || icon === 'snow' || icon === 'storm';
  return <Icon className={rainy ? 'wi r' : 'wi'} size="1em" strokeWidth={1.75} aria-hidden="true" />;
};
