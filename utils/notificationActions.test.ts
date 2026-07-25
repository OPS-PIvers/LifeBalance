import { describe, it, expect, beforeEach } from 'vitest';
import {
  appendNotificationAction,
  appendNotificationHabit,
  extractNotificationAction,
  consumeNotificationAction,
  consumeNotificationHabitId,
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

describe('habit target param (F-HABITS-03)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('treats log-habit as a known action', () => {
    expect(isKnownNotificationAction(NOTIFICATION_ACTIONS.logHabit)).toBe(true);
  });

  it('appends the habit id, composing with an existing query', () => {
    expect(appendNotificationHabit('/habits', 'h1')).toBe('/habits?nhabit=h1');
    expect(appendNotificationHabit('/habits?nact=log-habit', 'h1')).toBe(
      '/habits?nact=log-habit&nhabit=h1'
    );
  });

  it('round-trips an action and a habit id together', () => {
    const path = appendNotificationHabit(
      appendNotificationAction('/habits', NOTIFICATION_ACTIONS.logHabit),
      'h1'
    );
    window.history.replaceState(null, '', path);
    expect(consumeNotificationAction()).toBe(NOTIFICATION_ACTIONS.logHabit);
    expect(consumeNotificationHabitId()).toBe('h1');
    expect(window.location.search).toBe('');
  });

  it('reads the habit id out of a HashRouter hash query', () => {
    window.history.replaceState(null, '', `${'/'}#/habits?nhabit=h2`);
    expect(consumeNotificationHabitId()).toBe('h2');
    expect(window.location.hash).toBe('#/habits');
  });

  it('returns null without the param, and does not validate the id', () => {
    expect(consumeNotificationHabitId()).toBeNull();
    window.history.replaceState(null, '', '/habits?nhabit=not-a-real-id');
    // Deliberately unvalidated here — the caller resolves it against live habits.
    expect(consumeNotificationHabitId()).toBe('not-a-real-id');
  });

  it('percent-decodes the id it appended', () => {
    const path = appendNotificationHabit('/habits', 'a b&c');
    window.history.replaceState(null, '', path);
    expect(consumeNotificationHabitId()).toBe('a b&c');
  });
});
