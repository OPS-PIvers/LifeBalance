// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach } from 'vitest';
import { extractRecapParam, consumeRecapParam } from './recapParam';

const ORIGIN = 'https://app.example.com';

describe('extractRecapParam (mirrors the sw.js push URL shapes)', () => {
  it('reads and strips the param from the real query string', () => {
    const { isoWeek, cleanedHref } = extractRecapParam(`${ORIGIN}/?recap=2026-W27`);
    expect(isoWeek).toBe('2026-W27');
    expect(cleanedHref).toBe(`${ORIGIN}/`);
  });

  it('survives the SW nsrc tagging appended after it', () => {
    // public/sw.js appends `&nsrc=<type>` to a path that already has a query,
    // so the push URL arrives as /?recap=<week>&nsrc=weekly_recap.
    const { isoWeek, cleanedHref } = extractRecapParam(
      `${ORIGIN}/?recap=2026-W27&nsrc=weekly_recap`
    );
    expect(isoWeek).toBe('2026-W27');
    expect(cleanedHref).toBe(`${ORIGIN}/?nsrc=weekly_recap`);
  });

  it('reads and strips the param from inside a HashRouter hash', () => {
    const { isoWeek, cleanedHref } = extractRecapParam(`${ORIGIN}/#/?recap=2026-W27`);
    expect(isoWeek).toBe('2026-W27');
    expect(cleanedHref).toBe(`${ORIGIN}/#/`);
  });

  it('preserves other hash-query params when stripping', () => {
    const { isoWeek, cleanedHref } = extractRecapParam(`${ORIGIN}/#/?tab=bills&recap=2026-W27`);
    expect(isoWeek).toBe('2026-W27');
    expect(cleanedHref).toBe(`${ORIGIN}/#/?tab=bills`);
  });

  it('returns null and the original href when no param is present', () => {
    const href = `${ORIGIN}/#/habits`;
    expect(extractRecapParam(href)).toEqual({ isoWeek: null, cleanedHref: href });
  });

  it('never throws on malformed input', () => {
    expect(extractRecapParam('not a url')).toEqual({ isoWeek: null, cleanedHref: 'not a url' });
  });
});

describe('consumeRecapParam', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('returns the isoWeek and strips the param from the address bar', () => {
    window.history.replaceState(null, '', '/?recap=2026-W27#/');
    expect(consumeRecapParam()).toBe('2026-W27');
    expect(window.location.search).toBe('');
  });

  it('returns null without the param', () => {
    expect(consumeRecapParam()).toBeNull();
  });

  it('returns null for an empty value', () => {
    window.history.replaceState(null, '', '/?recap=');
    expect(consumeRecapParam()).toBeNull();
  });
});
