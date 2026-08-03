import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTimezoneOptions, getTimezoneOptionsIncluding } from './timezoneOptions';

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
