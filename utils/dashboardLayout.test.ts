import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  resolveDashboardOrder,
  getVisibleOrderedWidgetIds,
  moveWidget,
  toggleWidgetHidden,
} from '@/utils/dashboardLayout';

describe('resolveDashboardOrder', () => {
  it('falls back to the default order when layout is undefined', () => {
    expect(resolveDashboardOrder(undefined)).toEqual([...DEFAULT_DASHBOARD_WIDGET_ORDER]);
  });

  it('honors a custom order for known ids', () => {
    const custom = [...DASHBOARD_WIDGET_IDS].reverse();
    expect(resolveDashboardOrder(custom)).toEqual(custom);
  });

  it('drops unknown/stale ids', () => {
    const result = resolveDashboardOrder(['pulseStrip', 'someRetiredWidget', 'dailyHabits']);
    expect(result).not.toContain('someRetiredWidget');
    expect(result[0]).toBe('pulseStrip');
    expect(result[1]).toBe('dailyHabits');
  });

  it('appends widgets missing from a partial custom order, in default order', () => {
    const result = resolveDashboardOrder(['insight']);
    expect(result[0]).toBe('insight');
    expect(result.slice(1)).toEqual(DEFAULT_DASHBOARD_WIDGET_ORDER.filter(id => id !== 'insight'));
    expect(new Set(result)).toEqual(new Set(DASHBOARD_WIDGET_IDS));
  });
});

describe('getVisibleOrderedWidgetIds', () => {
  it('returns everything when nothing is hidden', () => {
    expect(getVisibleOrderedWidgetIds(undefined, undefined)).toEqual([...DEFAULT_DASHBOARD_WIDGET_ORDER]);
  });

  it('filters out hidden ids while preserving order', () => {
    const result = getVisibleOrderedWidgetIds(undefined, ['moneyRecap', 'kidsChores']);
    expect(result).not.toContain('moneyRecap');
    expect(result).not.toContain('kidsChores');
    expect(result.length).toBe(DASHBOARD_WIDGET_IDS.length - 2);
  });
});

describe('moveWidget', () => {
  it('swaps with the previous item on "up"', () => {
    const order = ['a', 'b', 'c'];
    expect(moveWidget(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
  });

  it('swaps with the next item on "down"', () => {
    const order = ['a', 'b', 'c'];
    expect(moveWidget(order, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at the top boundary', () => {
    const order = ['a', 'b', 'c'];
    expect(moveWidget(order, 'a', 'up')).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op at the bottom boundary', () => {
    const order = ['a', 'b', 'c'];
    expect(moveWidget(order, 'c', 'down')).toEqual(['a', 'b', 'c']);
  });

  it('is a no-op for an unknown id', () => {
    const order = ['a', 'b', 'c'];
    expect(moveWidget(order, 'z', 'up')).toEqual(['a', 'b', 'c']);
  });
});

describe('toggleWidgetHidden', () => {
  it('hides a visible widget', () => {
    expect(toggleWidgetHidden(undefined, 'insight')).toEqual(['insight']);
  });

  it('un-hides an already-hidden widget', () => {
    expect(toggleWidgetHidden(['insight', 'moneyRecap'], 'insight')).toEqual(['moneyRecap']);
  });
});
