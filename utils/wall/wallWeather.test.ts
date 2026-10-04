import { describe, expect, it } from 'vitest';
import { iconFor, parseForecast, rainNote, timeOfDayBlocks } from './wallWeather';

/** 48 hourly entries from 2026-10-03T00:00, with per-hour overrides. */
function hours(overrides: Record<number, { temp?: number; code?: number; precip?: number }> = {}) {
  return Array.from({ length: 48 }, (_, i) => {
    const day = i < 24 ? '2026-10-03' : '2026-10-04';
    const o = overrides[i] ?? {};
    return {
      time: `${day}T${String(i % 24).padStart(2, '0')}:00`,
      temp: o.temp ?? 50 + (i % 24),
      code: o.code ?? 0,
      precip: o.precip ?? 0,
    };
  });
}

describe('iconFor', () => {
  it('maps WMO codes', () => {
    expect([0, 2, 3, 45, 61, 81, 73, 95].map(iconFor)).toEqual(['sun', 'partly', 'cloud', 'fog', 'rain', 'rain', 'snow', 'storm']);
  });
});

describe('timeOfDayBlocks', () => {
  it('at 3:15 pm gives the rest of the afternoon, evening and overnight', () => {
    const blocks = timeOfDayBlocks(hours({ 18: { code: 61 }, 19: { code: 61 } }), '2026-10-03T15:15');
    expect(blocks.map(b => b.label)).toEqual(['Afternoon', 'Evening', 'Overnight']);
    expect(blocks[0]?.temp).toBe(66); // median of 15:00 (65) and 16:00 (66)
    expect(blocks[1]).toMatchObject({ icon: 'rain', rainy: true });
    // Overnight spans 21:00 → 05:00 the next day: 71,72,73,50..55 → median 54.
    expect(blocks[2]?.temp).toBe(54);
  });

  it('just after midnight starts with the rest of the overnight block', () => {
    const blocks = timeOfDayBlocks(hours(), '2026-10-04T01:10');
    expect(blocks.map(b => b.label)).toEqual(['Overnight', 'Morning', 'Afternoon']);
  });
});

describe('rainNote', () => {
  it('describes the first rainy run in the next 12 hours', () => {
    expect(rainNote(hours({ 18: { precip: 60 }, 19: { precip: 70 } }), '2026-10-03T15:15')).toBe('Rain likely 6–8 pm');
    expect(rainNote(hours({ 11: { precip: 60 }, 12: { precip: 70 } }), '2026-10-03T08:00')).toBe('Rain likely 11 am–1 pm');
    expect(rainNote(hours({ 15: { precip: 80 }, 16: { precip: 80 } }), '2026-10-03T15:15')).toBe('Rain likely until 5 pm');
  });

  it('is null when it stays dry or rain is past the horizon', () => {
    expect(rainNote(hours(), '2026-10-03T15:15')).toBeNull();
    expect(rainNote(hours({ 40: { precip: 90 } }), '2026-10-03T15:15')).toBeNull();
  });
});

describe('parseForecast', () => {
  const h = hours({ 18: { precip: 60 } });
  const raw = {
    current: { time: '2026-10-03T15:15', temperature_2m: 54.4, weather_code: 2 },
    hourly: {
      time: h.map(x => x.time),
      temperature_2m: h.map(x => x.temp),
      precipitation_probability: h.map(x => x.precip),
      weather_code: h.map(x => x.code),
    },
    daily: {
      time: ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
      temperature_2m_max: [61.2, 58, 55, 60, 62, 64],
      temperature_2m_min: [43, 41, 40, 44, 45, 47],
      weather_code: [2, 61, 3, 0, 0, 1],
      precipitation_probability_max: [60, 80, 10, 0, 0, 5],
    },
  };

  it('summarizes a valid response', () => {
    const w = parseForecast(raw, 123);
    expect(w).toMatchObject({ fetchedAt: 123, current: { temp: 54, icon: 'partly' }, high: 61, low: 43, rainNote: 'Rain likely 6–7 pm' });
    expect(w?.blocks).toHaveLength(3);
    expect(w?.days).toHaveLength(5);
    expect(w?.days[1]).toEqual({ date: '2026-10-04', high: 58, low: 41, icon: 'rain', precipMax: 80 });
  });

  it('rejects malformed responses', () => {
    expect(parseForecast(null, 0)).toBeNull();
    expect(parseForecast({ ...raw, current: { time: 'x' } }, 0)).toBeNull();
    expect(parseForecast({ ...raw, hourly: { ...raw.hourly, time: 'nope' } }, 0)).toBeNull();
  });
});
