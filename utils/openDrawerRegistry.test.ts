import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOpenDrawerCount,
  getTopOpenDrawerId,
  registerOpenDrawer,
  resetOpenDrawersForTest,
  subscribeOpenDrawers,
} from './openDrawerRegistry';

describe('openDrawerRegistry', () => {
  beforeEach(() => resetOpenDrawersForTest());

  it('tracks the count and reports the newest registration as the top', () => {
    const first = Symbol('first');
    const second = Symbol('second');

    expect(getOpenDrawerCount()).toBe(0);
    expect(getTopOpenDrawerId()).toBeUndefined();

    const closeFirst = registerOpenDrawer(first);
    expect(getTopOpenDrawerId()).toBe(first);

    const closeSecond = registerOpenDrawer(second);
    expect(getOpenDrawerCount()).toBe(2);
    // Escape must reach the nested sheet, not the one underneath it.
    expect(getTopOpenDrawerId()).toBe(second);

    closeSecond();
    expect(getTopOpenDrawerId()).toBe(first);
    closeFirst();
    expect(getOpenDrawerCount()).toBe(0);
  });

  it('unregisters out of order without disturbing the rest of the stack', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    const c = Symbol('c');
    const closeA = registerOpenDrawer(a);
    registerOpenDrawer(b);
    registerOpenDrawer(c);

    // A drawer buried in the middle can unmount first (its host re-renders it
    // away) — the sheet on top must stay on top.
    closeA();
    expect(getOpenDrawerCount()).toBe(2);
    expect(getTopOpenDrawerId()).toBe(c);
  });

  it('treats a second close call as a no-op rather than popping someone else', () => {
    const a = Symbol('a');
    const b = Symbol('b');
    const closeA = registerOpenDrawer(a);
    registerOpenDrawer(b);

    closeA();
    closeA();

    expect(getOpenDrawerCount()).toBe(1);
    expect(getTopOpenDrawerId()).toBe(b);
  });

  it('notifies subscribers on open and on close, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenDrawers(listener);

    const close = registerOpenDrawer(Symbol('a'));
    expect(listener).toHaveBeenCalledTimes(1);

    close();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    registerOpenDrawer(Symbol('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
