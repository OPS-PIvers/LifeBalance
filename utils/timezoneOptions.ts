/**
 * IANA timezone list for the timezone override picker (TZ-1, Settings →
 * Notifications). Prefers the runtime's `Intl.supportedValuesOf('timeZone')`
 * (broad modern-browser support, several hundred zones); falls back to a
 * small, common-zone list on runtimes that don't implement it (older Safari,
 * some test/SSR environments) so the picker never renders empty.
 */
const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** Every IANA zone the runtime knows about, or the fallback list. */
export const getTimezoneOptions = (): string[] => {
  if (typeof Intl.supportedValuesOf === 'function') {
    try {
      const zones = Intl.supportedValuesOf('timeZone');
      if (zones.length > 0) return zones;
    } catch {
      // Fall through to the static list below.
    }
  }
  return FALLBACK_TIMEZONES;
};

/**
 * `getTimezoneOptions()`, guaranteed to include `value` exactly once — so a
 * `<select>` bound to a stored/legacy zone the base list happens to omit
 * (or a runtime stuck on the small fallback list) never silently falls back
 * to displaying the first option instead of the member's actual value.
 */
export const getTimezoneOptionsIncluding = (value?: string | null): string[] => {
  const base = getTimezoneOptions();
  if (!value || base.includes(value)) return base;
  return [value, ...base];
};
