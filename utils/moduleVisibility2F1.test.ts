import { describe, it, expect } from 'vitest';
import type { Household, ModuleKey } from '@/types/schema';
import { DEFAULT_HIDDEN_DASHBOARD_WIDGETS } from '@/utils/dashboardLayout';
import {
  MEMBER_DEFAULT_HIDDEN_KEYS,
  NAV_LEAF_KEYS,
  NAV_PAGES,
  getPageNavigation,
  isModuleEnabled,
  isPlanTabVisible,
  isPlanVisible,
  resolveActiveLocation,
  resolveHiddenKeySet,
  resolveHiddenKeys,
  toggleHiddenKey,
} from './moduleVisibility';

/**
 * 2F.1 — per-member visibility: the read-time `'plan'` alias, the member
 * `hiddenKeys` layer, the widget-merge default rule, and the collapse rule.
 * The pre-2F.1 household-only behaviour stays covered in moduleVisibility.test.ts.
 */

/** Build the minimal settings shape the visibility helpers read. */
const settings = (
  moduleVisibility?: Household['moduleVisibility'],
): Pick<Household, 'moduleVisibility'> => ({ moduleVisibility });

const ALL_KEYS: ModuleKey[] = ['habits', 'money', 'lists', 'todos', 'meals', 'shopping'];

const ALL_MONEY_LEAVES = [
  'overview',
  'transactions',
  'trends',
  'calendar',
  'subscriptions',
  'buckets',
  'accounts',
];

describe("legacy 'plan' key alias (2F.1 rename)", () => {
  it("reads a household's saved plan:false as lists off", () => {
    expect(isModuleEnabled(settings({ plan: false }), 'lists')).toBe(false);
    expect(isPlanVisible(settings({ plan: false }))).toBe(false);
    expect(isPlanTabVisible(settings({ plan: false }), 'todos')).toBe(false);
  });

  it("reads a household's saved plan:true as lists on", () => {
    expect(isModuleEnabled(settings({ plan: true }), 'lists')).toBe(true);
  });

  it('lets an explicit lists value win over the legacy key (last write wins)', () => {
    expect(isModuleEnabled(settings({ plan: false, lists: true }), 'lists')).toBe(true);
    expect(isModuleEnabled(settings({ plan: true, lists: false }), 'lists')).toBe(false);
  });

  it('still fails open when neither key is present', () => {
    expect(isModuleEnabled(settings({}), 'lists')).toBe(true);
  });
});

describe('resolveHiddenKeys — the widget-merge default rule', () => {
  // ⚠️ THE trap this resolution rule exists to avoid: a naive merge of the two
  // systems (moduleVisibility fails OPEN, resolveHiddenWidgets failed CLOSED)
  // would surface five extra widgets on every existing member's Home the first
  // time they loaded the app after deploy.
  it('a never-customized member gets EXACTLY the five default-hidden widgets', () => {
    expect(resolveHiddenKeys(undefined)).toEqual(DEFAULT_HIDDEN_DASHBOARD_WIDGETS);
    expect(resolveHiddenKeys({})).toEqual(DEFAULT_HIDDEN_DASHBOARD_WIDGETS);
    expect(resolveHiddenKeys(null)).toEqual(DEFAULT_HIDDEN_DASHBOARD_WIDGETS);
  });

  it('the default hidden set contains NO nav leaf — pages fail open, widgets stay hidden', () => {
    const navKeys = new Set<string>(NAV_LEAF_KEYS);
    for (const key of MEMBER_DEFAULT_HIDDEN_KEYS) {
      expect(navKeys.has(key)).toBe(false);
    }
    // …so every nav leaf is visible for an un-customized member.
    const resolved = resolveHiddenKeySet(undefined);
    for (const key of NAV_LEAF_KEYS) {
      expect(resolved.has(key)).toBe(false);
    }
  });

  it('falls back to the pre-2F.1 dashboardHidden so existing widget choices survive', () => {
    expect(resolveHiddenKeys({ dashboardHidden: ['insight'] })).toEqual(['insight']);
  });

  it('hiddenKeys wins over dashboardHidden', () => {
    expect(resolveHiddenKeys({ hiddenKeys: ['trends'], dashboardHidden: ['insight'] })).toEqual([
      'trends',
    ]);
  });

  it('an explicit empty list wins over the defaults (member un-hid everything)', () => {
    expect(resolveHiddenKeys({ hiddenKeys: [] })).toEqual([]);
    expect(resolveHiddenKeys({ dashboardHidden: [] })).toEqual([]);
  });
});

describe('toggleHiddenKey', () => {
  it('hides a visible key', () => {
    expect(toggleHiddenKey(undefined, 'trends')).toEqual(['trends']);
  });

  it('un-hides an already-hidden key', () => {
    expect(toggleHiddenKey(['trends', 'insight'], 'trends')).toEqual(['insight']);
  });

  it('re-enabling a default-hidden widget keeps the rest of the defaults hidden', () => {
    const result = toggleHiddenKey([...resolveHiddenKeys(undefined)], 'insight');
    expect(result).not.toContain('insight');
    expect(new Set(result)).toEqual(
      new Set(DEFAULT_HIDDEN_DASHBOARD_WIDGETS.filter(id => id !== 'insight')),
    );
  });

  it('hiding a default-visible widget adds it on top of the defaults', () => {
    const result = toggleHiddenKey([...resolveHiddenKeys(undefined)], 'pulseStrip');
    expect(new Set(result)).toEqual(new Set([...DEFAULT_HIDDEN_DASHBOARD_WIDGETS, 'pulseStrip']));
  });
});

describe('the unified key set', () => {
  it('has no duplicate keys across pages and widgets', () => {
    const all = [...NAV_LEAF_KEYS, ...DEFAULT_HIDDEN_DASHBOARD_WIDGETS, 'home'];
    expect(new Set(all).size).toBe(all.length);
  });

  it('has a registry entry for every nav page', () => {
    expect(NAV_PAGES.map(p => p.key).sort()).toEqual(['habits', 'lists', 'money']);
  });

  it('LOCKOUT GUARD: settings is neither a nav page nor a hideable key', () => {
    expect(NAV_PAGES.some(p => p.path === '/settings')).toBe(false);
    expect((NAV_LEAF_KEYS as readonly string[]).includes('settings')).toBe(false);
    // Even a member who hides literally every key still reaches Settings:
    // there is no key that could remove it.
    const everythingHidden = new Set<string>([...NAV_LEAF_KEYS, 'home']);
    expect(everythingHidden.has('settings')).toBe(false);
  });

  it("covers Money's seven leaves and Habits' six", () => {
    expect(getPageNavigation('money', null).leaves.map(l => l.key)).toEqual(ALL_MONEY_LEAVES);
    expect(getPageNavigation('habits', null).leaves.map(l => l.key)).toEqual([
      'track',
      'history',
      'insights',
      'coach',
      'rewards',
      'challenges',
    ]);
  });
});

describe('getPageNavigation — household + member composed', () => {
  it('is fully visible for a legacy household and an un-customized member', () => {
    const nav = getPageNavigation('money', settings(undefined), resolveHiddenKeySet(undefined));
    expect(nav.isVisible).toBe(true);
    expect(nav.groups.map(g => g.key)).toEqual(['overview', 'activity', 'planned', 'balances']);
    expect(nav.soleLeaf).toBeNull();
  });

  it('drops a group once the member hides all of its leaves', () => {
    const nav = getPageNavigation('money', null, ['transactions', 'trends']);
    expect(nav.groups.map(g => g.key)).toEqual(['overview', 'planned', 'balances']);
  });

  it('a group with one remaining leaf becomes single-view (no sub-view menu)', () => {
    const nav = getPageNavigation('money', null, ['trends']);
    expect(nav.groups.find(g => g.key === 'activity')?.leaves.map(l => l.key)).toEqual([
      'transactions',
    ]);
  });

  it('COLLAPSE RULE: exactly one leaf left reports soleLeaf', () => {
    const nav = getPageNavigation(
      'money',
      null,
      ALL_MONEY_LEAVES.filter(k => k !== 'calendar'),
    );
    expect(nav.leaves).toHaveLength(1);
    expect(nav.groups).toHaveLength(1);
    expect(nav.soleLeaf?.key).toBe('calendar');
  });

  it('reports the page invisible once every leaf is hidden', () => {
    const nav = getPageNavigation('money', null, ALL_MONEY_LEAVES);
    expect(nav.isVisible).toBe(false);
    expect(nav.soleLeaf).toBeNull();
  });

  it('a household-off page stays off no matter what the member does', () => {
    expect(getPageNavigation('money', settings({ money: false }), []).isVisible).toBe(false);
  });

  it('Lists leaves keep their own household toggles alongside the member layer', () => {
    const nav = getPageNavigation('lists', settings({ meals: false }), ['shopping']);
    expect(nav.leaves.map(l => l.key)).toEqual(['todos']);
    expect(nav.soleLeaf?.key).toBe('todos');
  });
});

describe('isModuleEnabled with the member layer', () => {
  it('derives a page key from its leaves', () => {
    expect(isModuleEnabled(null, 'money', ALL_MONEY_LEAVES)).toBe(false);
    expect(isModuleEnabled(null, 'money', ALL_MONEY_LEAVES.slice(1))).toBe(true);
  });

  it('treats Lists sub-tab keys as leaves in their own right', () => {
    expect(isModuleEnabled(null, 'todos', ['todos'])).toBe(false);
    expect(isModuleEnabled(null, 'meals', ['todos'])).toBe(true);
  });

  it('omitting the member layer reproduces the pre-2F.1 household-only answer', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(settings({}), key)).toBe(isModuleEnabled(settings({}), key, []));
      expect(isModuleEnabled(settings({ [key]: false }), key)).toBe(false);
    }
  });

  it('member-scoping isPlanTabVisible is what stops to-do Action Queue cards', () => {
    // useActionQueue gates its to-do items on this exact call.
    expect(isPlanTabVisible(settings(undefined), 'todos', ['todos'])).toBe(false);
    expect(isPlanTabVisible(settings(undefined), 'todos', ['meals'])).toBe(true);
  });

  it('isPlanVisible goes false once the member hides all three Lists tabs', () => {
    expect(isPlanVisible(settings(undefined), ['todos', 'meals', 'shopping'])).toBe(false);
    expect(isPlanVisible(settings(undefined), ['todos', 'meals'])).toBe(true);
  });
});

describe('resolveActiveLocation', () => {
  const full = () => getPageNavigation('money', null, []);

  it('keeps a deep-linked leaf and reports its group', () => {
    expect(resolveActiveLocation(full(), 'trends')).toEqual({ group: 'activity', leaf: 'trends' });
  });

  it("entering by group key lands on the group's first visible leaf", () => {
    expect(resolveActiveLocation(full(), 'balances')).toEqual({
      group: 'balances',
      leaf: 'buckets',
    });
  });

  it('a hidden leaf falls back rather than rendering an empty view', () => {
    const nav = getPageNavigation('money', null, ['buckets']);
    // A stale `state: { tab: 'buckets' }` deep link…
    expect(resolveActiveLocation(nav, 'buckets')).toEqual({ group: 'overview', leaf: 'overview' });
    // …and entering the group lands on what's left of it.
    expect(resolveActiveLocation(nav, 'balances')).toEqual({
      group: 'balances',
      leaf: 'accounts',
    });
  });

  it("falls back to the page's first visible leaf for an unknown value", () => {
    expect(resolveActiveLocation(full(), 'nonsense')).toEqual({
      group: 'overview',
      leaf: 'overview',
    });
  });

  it('returns null when the page has nothing to show', () => {
    const nav = getPageNavigation('money', settings({ money: false }), []);
    expect(resolveActiveLocation(nav, 'overview')).toBeNull();
  });
});
