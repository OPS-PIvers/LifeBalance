import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_WIDGET_IDS,
  DEFAULT_DASHBOARD_WIDGET_ORDER,
  DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
  resolveHiddenWidgets,
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
  it('returns everything when the member explicitly hides nothing', () => {
    expect(getVisibleOrderedWidgetIds(undefined, [])).toEqual([...DEFAULT_DASHBOARD_WIDGET_ORDER]);
  });

  it('applies the lean default-hidden set for never-customized members', () => {
    const result = getVisibleOrderedWidgetIds(undefined, undefined);
    expect(result).toEqual(
      DEFAULT_DASHBOARD_WIDGET_ORDER.filter(id => !(DEFAULT_HIDDEN_DASHBOARD_WIDGETS as readonly string[]).includes(id))
    );
    // The triage core survives the default trim.
    expect(result).toContain('pulseStrip');
    expect(result).toContain('dailyHabits');
    expect(result).toContain('weeklyRecap');
    expect(result).toContain('moneyRecap');
  });

  it('filters out hidden ids while preserving order', () => {
    const result = getVisibleOrderedWidgetIds(undefined, ['moneyRecap', 'kidsChores']);
    expect(result).not.toContain('moneyRecap');
    expect(result).not.toContain('kidsChores');
    expect(result.length).toBe(DASHBOARD_WIDGET_IDS.length - 2);
  });
});

describe('first toggle from never-customized defaults (Settings path)', () => {
  // The Settings editor resolves the effective hidden list before toggling,
  // so a never-customized member's first toggle persists the lean defaults
  // ± the toggled id — not a bare one-element list.
  it('re-enabling a default-hidden widget keeps the rest of the defaults hidden', () => {
    const result = toggleWidgetHidden([...resolveHiddenWidgets(undefined)], 'insight');
    expect(result).not.toContain('insight');
    expect(new Set(result)).toEqual(
      new Set(DEFAULT_HIDDEN_DASHBOARD_WIDGETS.filter(id => id !== 'insight'))
    );
  });

  it('hiding a default-visible widget adds it on top of the defaults', () => {
    const result = toggleWidgetHidden([...resolveHiddenWidgets(undefined)], 'pulseStrip');
    expect(new Set(result)).toEqual(new Set([...DEFAULT_HIDDEN_DASHBOARD_WIDGETS, 'pulseStrip']));
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
