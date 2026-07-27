// @vitest-environment jsdom
// The default test environment is node (see vite.config.ts `projects`). This
// suite drives real browser APIs — window/document/localStorage — so it opts
// back into jsdom. Without this it fails outright rather than degrading.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The util imports the analytics wrapper (which pulls in firebase.config);
// stub it so this stays a pure URL-logic test.
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

import { track } from '@/services/analytics';
import {
  appendNotificationSource,
  consumeNotificationSource,
  trackNotificationOpenFromUrl,
} from './notificationSource';

const ORIGIN = 'https://app.example.com';

describe('notification source round-trip (mirrors public/sw.js tagging)', () => {
  it('round-trips a plain path the way the SW openWindow path produces it', () => {
    const tagged = appendNotificationSource('/habits', 'habit_reminder');
    expect(tagged).toBe('/habits?nsrc=habit_reminder');

    // The SW builds the full URL exactly like this before openWindow().
    const href = new URL(tagged, ORIGIN).href;
    const { type, cleanedHref } = consumeNotificationSource(href);
    expect(type).toBe('habit_reminder');
    expect(cleanedHref).toBe(`${ORIGIN}/habits`);
  });

  it('appends with & when the path already carries a query', () => {
    const tagged = appendNotificationSource('/budget?tab=bills', 'bill_reminder');
    expect(tagged).toBe('/budget?tab=bills&nsrc=bill_reminder');

    const { type, cleanedHref } = consumeNotificationSource(new URL(tagged, ORIGIN).href);
    expect(type).toBe('bill_reminder');
    expect(cleanedHref).toBe(`${ORIGIN}/budget?tab=bills`);
  });

  it('reads and strips the param from inside a HashRouter hash', () => {
    const href = `${ORIGIN}/#/habits?nsrc=streak_warning`;
    const { type, cleanedHref } = consumeNotificationSource(href);
    expect(type).toBe('streak_warning');
    expect(cleanedHref).toBe(`${ORIGIN}/#/habits`);
  });

  it('preserves other hash-query params when stripping', () => {
    const href = `${ORIGIN}/#/budget?tab=bills&nsrc=budget_alert`;
    const { type, cleanedHref } = consumeNotificationSource(href);
    expect(type).toBe('budget_alert');
    expect(cleanedHref).toBe(`${ORIGIN}/#/budget?tab=bills`);
  });

  it('URL-encodes and decodes the type', () => {
    const tagged = appendNotificationSource('/', 'a b/c');
    const { type } = consumeNotificationSource(new URL(tagged, ORIGIN).href);
    expect(type).toBe('a b/c');
  });

  it('returns null and the original href when no param is present', () => {
    const href = `${ORIGIN}/#/habits`;
    expect(consumeNotificationSource(href)).toEqual({ type: null, cleanedHref: href });
  });

  it('never throws on malformed input', () => {
    expect(consumeNotificationSource('not a url')).toEqual({
      type: null,
      cleanedHref: 'not a url',
    });
  });
});

describe('trackNotificationOpenFromUrl', () => {
  beforeEach(() => {
    vi.mocked(track).mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('fires notification_opened and strips the param from the address bar', () => {
    window.history.replaceState(null, '', '/?nsrc=habit_reminder#/habits');
    trackNotificationOpenFromUrl();
    expect(track).toHaveBeenCalledWith('notification_opened', { type: 'habit_reminder' });
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/habits');
  });

  it('no-ops without the param', () => {
    trackNotificationOpenFromUrl();
    expect(track).not.toHaveBeenCalled();
  });
});
