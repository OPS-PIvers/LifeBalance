import { describe, expect, it } from 'vitest';
import { countdownText, formatPairingCode, geocodeUrl, lastSeenText, parseGeocode } from './wallSettingsView';

const NOW = Date.parse('2026-10-03T20:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('lastSeenText', () => {
  it('reads naturally and turns stale after 30 minutes', () => {
    expect(lastSeenText(undefined, NOW)).toEqual({ text: 'Not seen yet', stale: true });
    expect(lastSeenText(ago(0.2), NOW)).toEqual({ text: 'Last seen just now', stale: false });
    expect(lastSeenText(ago(4), NOW)).toEqual({ text: 'Last seen 4 min ago', stale: false });
    expect(lastSeenText(ago(31), NOW)).toEqual({ text: 'Last seen 31 min ago', stale: true });
    expect(lastSeenText(ago(180), NOW)).toEqual({ text: 'Last seen 3 h ago', stale: true });
    expect(lastSeenText(ago(60 * 72), NOW)).toEqual({ text: 'Last seen 3 days ago', stale: true });
  });
});

describe('pairing code display', () => {
  it('groups the code and counts down', () => {
    expect(formatPairingCode('482913')).toBe('482 913');
    expect(countdownText(new Date(NOW + 9 * 60_000 + 41_000).toISOString(), NOW)).toBe('9:41');
    expect(countdownText(new Date(NOW - 1).toISOString(), NOW)).toBeNull();
  });
});

describe('geocoding', () => {
  it('builds the query and parses results', () => {
    expect(geocodeUrl(' Orono ')).toContain('name=Orono');
    expect(
      parseGeocode({
        results: [
          { name: 'Orono', latitude: 44.97, longitude: -93.6, admin1: 'Minnesota', country_code: 'US' },
          { name: 'Bad' },
        ],
      })
    ).toEqual([{ label: 'Orono, Minnesota, US', lat: 44.97, lon: -93.6 }]);
    expect(parseGeocode({})).toEqual([]);
    expect(parseGeocode(null)).toEqual([]);
  });
});
