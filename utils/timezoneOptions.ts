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

/**
 * A zone's current UTC offset, formatted like `GMT-5` / `GMT+5:30` — DST-aware
 * (delegates to the runtime's own Intl offset calculation rather than
 * hand-rolled arithmetic, so it's correct on both sides of a DST transition).
 * Returns '' for a zone the runtime can't resolve (e.g. a stale/deprecated
 * IANA name that only survives via `getTimezoneOptionsIncluding`'s legacy
 * guarantee) rather than throwing.
 */
export const formatTimezoneOffset = (zone: string, date: Date = new Date()): string => {
  try {
    // Deliberately called WITHOUT `new` — Intl.DateTimeFormat is one of the
    // few builtins that's both constructible and directly callable, matching
    // this file's/the component's other `Intl.DateTimeFormat(...)` call sites
    // and, unlike `new Intl.DateTimeFormat(...)`, working correctly under an
    // arrow-function `Intl.DateTimeFormat` test mock (see
    // NotificationSettings.test.tsx's stubDetectedTimezone), which `new`
    // cannot invoke.
    const part = Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
};

export interface TimezoneSelectOption {
  value: string;
  label: string;
}

/**
 * Display-ready options for the Settings → Notifications timezone `<select>`
 * (TZ-1 Finding 3): plain `Intl.supportedValuesOf('timeZone')` output is ~400
 * bare alphabetical IANA identifiers with no offset and no way to spot the
 * device's own zone, which makes the picker markedly worse than its
 * hour-select neighbours. Each option is annotated with its current UTC
 * offset, and the browser-detected zone is pinned to the top and labeled so
 * it's identifiable at a glance.
 *
 * Built on top of `getTimezoneOptionsIncluding` (not a reimplementation) so
 * the legacy-value guarantee it provides — a stored zone absent from the base
 * list is prepended rather than silently dropped, see its `Moon/Base_Alpha`
 * unit test — still holds for the `value`s this returns; only the `label`s
 * and ordering are new.
 */
export const getTimezoneSelectOptions = (
  storedValue: string | null | undefined,
  detectedZone: string
): TimezoneSelectOption[] => {
  const zones = getTimezoneOptionsIncluding(storedValue);
  const ordered = zones.includes(detectedZone)
    ? [detectedZone, ...zones.filter((zone) => zone !== detectedZone)]
    : zones;

  return ordered.map((zone) => {
    const offset = formatTimezoneOffset(zone, new Date());
    const detectedSuffix = zone === detectedZone ? ' — detected' : '';
    const label = offset ? `${zone} (${offset})${detectedSuffix}` : `${zone}${detectedSuffix}`;
    return { value: zone, label };
  });
};
