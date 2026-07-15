import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendNotificationAction,
  extractNotificationAction,
  consumeNotificationAction,
  getNotificationActions,
  isKnownNotificationAction,
  NOTIFICATION_ACTIONS,
} from './notificationActions';

const ORIGIN = 'https://app.example.com';

describe('getNotificationActions', () => {
  it('returns pay + snooze buttons for a bill reminder', () => {
    const actions = getNotificationActions('bill_reminder');
    expect(actions.map((a) => a.action)).toEqual([
      NOTIFICATION_ACTIONS.payBill,
      NOTIFICATION_ACTIONS.snoozeBill,
    ]);
    expect(actions.every((a) => a.title.length > 0)).toBe(true);
  });

  it('returns an empty array for a type with no actions', () => {
    expect(getNotificationActions('habit_reminder')).toEqual([]);
    expect(getNotificationActions('anything')).toEqual([]);
  });
});

describe('isKnownNotificationAction', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isKnownNotificationAction(NOTIFICATION_ACTIONS.payBill)).toBe(true);
    expect(isKnownNotificationAction(NOTIFICATION_ACTIONS.snoozeBill)).toBe(true);
    expect(isKnownNotificationAction('drop-tables')).toBe(false);
    expect(isKnownNotificationAction(null)).toBe(false);
    expect(isKnownNotificationAction(undefined)).toBe(false);
  });
});

describe('appendNotificationAction', () => {
  it('appends with ? when no existing query', () => {
    expect(appendNotificationAction('/budget', 'pay-bill')).toBe('/budget?nact=pay-bill');
  });

  it('appends with & when a query already exists', () => {
    expect(appendNotificationAction('/budget?nsrc=bill_reminder', 'pay-bill')).toBe(
      '/budget?nsrc=bill_reminder&nact=pay-bill'
    );
  });
});

describe('extractNotificationAction (mirrors the sw.js push URL shapes)', () => {
  it('reads and strips the param from the real query string', () => {
    const { action, cleanedHref } = extractNotificationAction(`${ORIGIN}/budget?nact=pay-bill`);
    expect(action).toBe('pay-bill');
    expect(cleanedHref).toBe(`${ORIGIN}/budget`);
  });

  it('survives an nsrc tag appended alongside it', () => {
    const { action, cleanedHref } = extractNotificationAction(
      `${ORIGIN}/budget?nact=snooze-bill&nsrc=bill_reminder`
    );
    expect(action).toBe('snooze-bill');
    expect(cleanedHref).toBe(`${ORIGIN}/budget?nsrc=bill_reminder`);
  });

  it('reads and strips the param from inside a HashRouter hash', () => {
    const { action, cleanedHref } = extractNotificationAction(`${ORIGIN}/#/budget?nact=pay-bill`);
    expect(action).toBe('pay-bill');
    expect(cleanedHref).toBe(`${ORIGIN}/#/budget`);
  });

  it('preserves other hash-query params when stripping', () => {
    const { action, cleanedHref } = extractNotificationAction(
      `${ORIGIN}/#/budget?tab=bills&nact=pay-bill`
    );
    expect(action).toBe('pay-bill');
    expect(cleanedHref).toBe(`${ORIGIN}/#/budget?tab=bills`);
  });

  it('returns null and the original href when no param is present', () => {
    const href = `${ORIGIN}/#/habits`;
    expect(extractNotificationAction(href)).toEqual({ action: null, cleanedHref: href });
  });

  it('never throws on malformed input', () => {
    expect(extractNotificationAction('not a url')).toEqual({
      action: null,
      cleanedHref: 'not a url',
    });
  });
});

describe('consumeNotificationAction', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('returns a known action and strips the param from the address bar', () => {
    window.history.replaceState(null, '', '/budget?nact=pay-bill#/');
    expect(consumeNotificationAction()).toBe('pay-bill');
    expect(window.location.search).toBe('');
  });

  it('returns null without the param', () => {
    expect(consumeNotificationAction()).toBeNull();
  });

  it('strips but returns null for an unrecognized action', () => {
    window.history.replaceState(null, '', '/budget?nact=drop-tables#/');
    expect(consumeNotificationAction()).toBeNull();
    expect(window.location.search).toBe('');
  });
});
