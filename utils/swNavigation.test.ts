import { describe, it, expect, beforeEach } from 'vitest';
import { applyNavigateMessage, readNavigateMessage, SW_NAVIGATE_MESSAGE } from './swNavigation';

describe('readNavigateMessage', () => {
  it('accepts a plain in-app path', () => {
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '/habits' })).toBe('/habits');
  });

  it('keeps the deep-link query intact', () => {
    expect(
      readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '/habits?due=a,b&nact=log-habit' })
    ).toBe('/habits?due=a,b&nact=log-habit');
  });

  it('ignores messages that are not a navigation', () => {
    expect(readNavigateMessage({ type: 'SOMETHING_ELSE', url: '/habits' })).toBeNull();
    expect(readNavigateMessage({ url: '/habits' })).toBeNull();
    expect(readNavigateMessage(null)).toBeNull();
    expect(readNavigateMessage('/habits')).toBeNull();
  });

  it('ignores a missing or empty url', () => {
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE })).toBeNull();
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '' })).toBeNull();
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 42 })).toBeNull();
  });

  // The value ends up in `location`, so anything that could escape the app is
  // rejected outright rather than sanitized into something plausible.
  it('rejects anything that is not an in-app absolute path', () => {
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 'https://evil.test/' })).toBeNull();
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '//evil.test/' })).toBeNull();
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '/\\evil.test/' })).toBeNull();
    expect(
      readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 'javascript:alert(1)' })
    ).toBeNull();
    expect(readNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 'habits' })).toBeNull();
  });
});

describe('applyNavigateMessage', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  // HashRouter routes off the hash, so this both navigates the app AND leaves
  // the deep-link params where consumeNotificationAction/Habit look for them.
  it('routes the app by writing the path into the hash', () => {
    applyNavigateMessage('/habits?due=a&nact=log-habit&nhabit=a');
    expect(window.location.hash).toBe('#/habits?due=a&nact=log-habit&nhabit=a');
  });
});
