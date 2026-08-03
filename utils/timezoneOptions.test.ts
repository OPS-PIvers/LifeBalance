import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  getTimezoneOptions,
  getTimezoneOptionsIncluding,
  formatTimezoneOffset,
  getTimezoneSelectOptions,
} from './timezoneOptions';

describe('getTimezoneOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses Intl.supportedValuesOf when available', () => {
    const zones = getTimezoneOptions();
    // The full IANA-backed list runs into the hundreds; 'UTC' itself is an
    // alias some runtimes omit from supportedValuesOf, so assert on a zone
    // that's unambiguously always present instead.
    expect(zones.length).toBeGreaterThan(20);
    expect(zones).toContain('America/Chicago');
  });

  it('falls back to a static list when Intl.supportedValuesOf is unavailable', () => {
    // Cast to a partial shape (rather than `@ts-expect-error`) to simulate a
    // runtime without the API — `Intl.supportedValuesOf` is typed as
    // required, so deleting it directly wouldn't type-check.
    const intl = Intl as unknown as { supportedValuesOf?: typeof Intl.supportedValuesOf };
    const original = intl.supportedValuesOf;
    delete intl.supportedValuesOf;

    const zones = getTimezoneOptions();
    expect(zones).toContain('UTC');
    expect(zones).toContain('America/Chicago');
    expect(zones.length).toBeGreaterThan(0);

    intl.supportedValuesOf = original;
  });

  it('falls back when Intl.supportedValuesOf throws', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new Error('unsupported key');
    });

    const zones = getTimezoneOptions();
    expect(zones).toContain('UTC');
  });
});

describe('getTimezoneOptionsIncluding', () => {
  it('does not duplicate a value already in the base list', () => {
    const zones = getTimezoneOptionsIncluding('UTC');
    expect(zones.filter((z) => z === 'UTC')).toHaveLength(1);
  });

  it('prepends a legacy/unknown value not in the base list', () => {
    const zones = getTimezoneOptionsIncluding('Moon/Base_Alpha');
    expect(zones[0]).toBe('Moon/Base_Alpha');
    expect(zones.filter((z) => z === 'Moon/Base_Alpha')).toHaveLength(1);
  });

  it('returns the base list unchanged when no value is given', () => {
    expect(getTimezoneOptionsIncluding(undefined)).toEqual(getTimezoneOptions());
    expect(getTimezoneOptionsIncluding(null)).toEqual(getTimezoneOptions());
    expect(getTimezoneOptionsIncluding('')).toEqual(getTimezoneOptions());
  });
});

describe('formatTimezoneOffset', () => {
  it('formats a known zone as a GMT offset', () => {
    // Fixed date sidesteps any DST flakiness in the assertion itself — the
    // point under test is the format, not the specific numeral.
    const offset = formatTimezoneOffset('America/Chicago', new Date('2026-01-15T00:00:00Z'));
    expect(offset).toMatch(/^GMT[+-]\d/);
  });

  it('formats UTC as GMT+0', () => {
    expect(formatTimezoneOffset('UTC', new Date('2026-01-15T00:00:00Z'))).toBe('GMT+0');
  });

  it('returns an empty string for a zone the runtime cannot resolve, rather than throwing', () => {
    expect(() => formatTimezoneOffset('Moon/Base_Alpha')).not.toThrow();
    expect(formatTimezoneOffset('Moon/Base_Alpha')).toBe('');
  });
});

describe('getTimezoneSelectOptions', () => {
  it('pins the detected zone to the top and labels it', () => {
    const options = getTimezoneSelectOptions(undefined, 'America/Chicago');
    expect(options[0]?.value).toBe('America/Chicago');
    expect(options[0]?.label).toContain('detected');
    // Exactly one entry for the detected zone — pinning must not duplicate it.
    expect(options.filter((opt) => opt.value === 'America/Chicago')).toHaveLength(1);
  });

  it('annotates every option with its current UTC offset', () => {
    const options = getTimezoneSelectOptions(undefined, 'America/Chicago');
    expect(options.length).toBeGreaterThan(20);
    for (const opt of options) {
      expect(opt.label).toMatch(new RegExp(`^${opt.value.replace(/\//g, '\\/')} \\(GMT`));
    }
  });

  it('still surfaces a legacy/unknown stored value not in the base list', () => {
    const options = getTimezoneSelectOptions('Moon/Base_Alpha', 'America/Chicago');
    expect(options.filter((opt) => opt.value === 'Moon/Base_Alpha')).toHaveLength(1);
    // No real offset is resolvable for it, so the label degrades to the bare zone.
    const legacyOption = options.find((opt) => opt.value === 'Moon/Base_Alpha');
    expect(legacyOption?.label).toBe('Moon/Base_Alpha');
  });

  it('does not duplicate the detected zone when it is also the stored value', () => {
    const options = getTimezoneSelectOptions('America/Chicago', 'America/Chicago');
    expect(options.filter((opt) => opt.value === 'America/Chicago')).toHaveLength(1);
    expect(options[0]?.value).toBe('America/Chicago');
  });
});
