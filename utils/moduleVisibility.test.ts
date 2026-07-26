import { describe, it, expect } from 'vitest';
import type { Household, ModuleKey } from '@/types/schema';
import { DEFAULT_HIDDEN_DASHBOARD_WIDGETS } from '@/utils/dashboardLayout';
import {
  MEMBER_DEFAULT_HIDDEN_KEYS,
  NAV_LEAF_KEYS,
  NAV_PAGES,
  flagGatedHiddenKeys,
  getPageNavigation,
  isModuleEnabled,
  isNavLeafKeyVisible,
  isPlanTabVisible,
  isPlanVisible,
  resolveActiveLocation,
  resolveHiddenKeySet,
  resolveHiddenKeys,
  toggleHiddenKey,
  type HiddenKeys,
  type NavLeafKey,
  type PlanTab,
} from './moduleVisibility';

/**
 * The whole visibility module: the pre-2F.1 household layer (`moduleVisibility`,
 * fail-open), the 2F.1 per-member layer (`hiddenKeys`, leaves only), the global
 * flag gates that ride the same hidden set, and the derived answers built on top
 * (page visibility, the collapse rule, active-location resolution).
 */

/** Build the minimal settings shape the visibility helpers read. */
const settings = (
  moduleVisibility?: Household['moduleVisibility'],
): Pick<Household, 'moduleVisibility'> => ({ moduleVisibility });

const ALL_KEYS: ModuleKey[] = ['habits', 'money', 'lists', 'todos', 'meals', 'shopping'];
const PLAN_TABS: PlanTab[] = ['todos', 'meals', 'shopping'];

const ALL_MONEY_LEAVES = [
  'overview',
  'transactions',
  'trends',
  'calendar',
  'subscriptions',
  'buckets',
  'accounts',
];

/**
 * The three shapes a caller can pass for "this member hides nothing": omitted,
 * an empty array, and an empty Set. Every derived answer must agree across all
 * three — an "empty means enabled" shortcut is exactly the bug this pins.
 */
const NO_HIDDEN_KEYS: HiddenKeys[] = [undefined, [], new Set<string>()];

describe('isModuleEnabled (fail-open)', () => {
  it('treats null settings as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(null, key)).toBe(true);
    }
  });

  it('treats undefined settings as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(undefined, key)).toBe(true);
    }
  });

  it('treats an absent moduleVisibility field as all enabled (legacy household)', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(settings(undefined), key)).toBe(true);
    }
  });

  it('treats an empty moduleVisibility map as all enabled', () => {
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(settings({}), key)).toBe(true);
    }
  });

  it('treats an absent KEY in a partial map as enabled', () => {
    const s = settings({ money: false });
    expect(isModuleEnabled(s, 'money')).toBe(false);
    // habits is absent from the partial map -> enabled
    expect(isModuleEnabled(s, 'habits')).toBe(true);
  });

  it('honors an explicit false', () => {
    expect(isModuleEnabled(settings({ habits: false }), 'habits')).toBe(false);
  });

  it('honors an explicit true', () => {
    expect(isModuleEnabled(settings({ habits: true }), 'habits')).toBe(true);
  });

  it('returns false only when every key is explicitly off (all-off)', () => {
    const allOff = settings(
      ALL_KEYS.reduce<Partial<Record<ModuleKey, boolean>>>((acc, k) => {
        acc[k] = false;
        return acc;
      }, {}),
    );
    for (const key of ALL_KEYS) {
      expect(isModuleEnabled(allOff, key)).toBe(false);
    }
  });
});

describe('isPlanVisible', () => {
  it('is true for a legacy household (absent field)', () => {
    expect(isPlanVisible(settings(undefined))).toBe(true);
  });

  it('is true when lists on and all tabs on', () => {
    expect(isPlanVisible(settings({ lists: true, todos: true, meals: true, shopping: true }))).toBe(true);
  });

  it('is false when lists is off, even if every tab is on', () => {
    expect(isPlanVisible(settings({ lists: false, todos: true, meals: true, shopping: true }))).toBe(false);
  });

  it('is false when lists is on but ALL tabs are off (would be an empty page)', () => {
    expect(isPlanVisible(settings({ lists: true, todos: false, meals: false, shopping: false }))).toBe(false);
  });

  it('is true when lists is on and exactly one tab is on', () => {
    expect(isPlanVisible(settings({ lists: true, todos: false, meals: false, shopping: true }))).toBe(true);
    expect(isPlanVisible(settings({ lists: true, todos: true, meals: false, shopping: false }))).toBe(true);
    expect(isPlanVisible(settings({ lists: true, todos: false, meals: true, shopping: false }))).toBe(true);
  });
});

describe('isPlanTabVisible', () => {
  it('is true for every tab in a legacy household (absent field)', () => {
    for (const tab of PLAN_TABS) {
      expect(isPlanTabVisible(settings(undefined), tab)).toBe(true);
    }
  });

  it('is false for every tab when the lists master toggle is off, even if the tab is on', () => {
    const s = settings({ lists: false, todos: true, meals: true, shopping: true });
    for (const tab of PLAN_TABS) {
      expect(isPlanTabVisible(s, tab)).toBe(false);
    }
  });

  it('gates each tab independently when lists is on', () => {
    const s = settings({ lists: true, todos: true, meals: false, shopping: true });
    expect(isPlanTabVisible(s, 'todos')).toBe(true);
    expect(isPlanTabVisible(s, 'meals')).toBe(false);
    expect(isPlanTabVisible(s, 'shopping')).toBe(true);
  });
});

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

describe('isNavLeafKeyVisible', () => {
  it('resolves every registry leaf key (the key → def map is total)', () => {
    for (const key of NAV_LEAF_KEYS) {
      expect(isNavLeafKeyVisible(null, key)).toBe(true);
    }
  });

  it("honours the leaf's household module", () => {
    expect(isNavLeafKeyVisible(settings({ money: false }), 'transactions')).toBe(false);
    expect(isNavLeafKeyVisible(settings({ habits: false }), 'track')).toBe(false);
    // A Lists leaf carries its OWN household module, not the page's.
    expect(isNavLeafKeyVisible(settings({ meals: false }), 'meals')).toBe(false);
    expect(isNavLeafKeyVisible(settings({ meals: false }), 'todos')).toBe(true);
  });

  it("honours the member's hidden list", () => {
    expect(isNavLeafKeyVisible(null, 'transactions', ['transactions'])).toBe(false);
    // …and says nothing about its siblings.
    expect(isNavLeafKeyVisible(null, 'trends', ['transactions'])).toBe(true);
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

describe('flagGatedHiddenKeys — a global flag gate rides the member hidden set', () => {
  it('names Coach while power tools are off, and nothing while they are on', () => {
    expect(flagGatedHiddenKeys({ powerTools: false })).toEqual(['coach']);
    expect(flagGatedHiddenKeys({ powerTools: true })).toEqual([]);
  });

  it('a flag-gated leaf drops out of the page tree exactly like a hidden one', () => {
    const nav = getPageNavigation('habits', null, flagGatedHiddenKeys({ powerTools: false }));
    expect(nav.groups.find(g => g.key === 'progress')?.leaves.map(l => l.key)).toEqual([
      'history',
      'insights',
    ]);
  });

  it('a flag-gated leaf takes part in the COLLAPSE RULE', () => {
    // Only History and Coach left by the member — power tools off leaves ONE
    // reachable view, so the page must collapse rather than show a strip of one.
    const hidden = new Set<string>([
      'track',
      'insights',
      'rewards',
      'challenges',
      ...flagGatedHiddenKeys({ powerTools: false }),
    ]);
    expect(getPageNavigation('habits', null, hidden).soleLeaf?.key).toBe('history');
  });

  // ⚠️ THE blank-page scenario: power tools off + every other Habits leaf hidden
  // by the member. The nav (isModuleEnabled), the route guard and the page must
  // reach the SAME verdict — if isModuleEnabled said "true" here, BottomNav would
  // offer Habits and the page would render a header with no tabs and no content.
  it('BLANK-PAGE GUARD: power tools off + every other leaf hidden ⇒ Habits is unreachable everywhere', () => {
    const hidden = new Set<string>([
      'track',
      'history',
      'insights',
      'rewards',
      'challenges',
      ...flagGatedHiddenKeys({ powerTools: false }),
    ]);
    const nav = getPageNavigation('habits', null, hidden);
    expect(nav.isVisible).toBe(false);
    expect(nav.leaves).toEqual([]);
    expect(nav.soleLeaf).toBeNull();
    // What BottomNav and ModuleRoute ask…
    expect(isModuleEnabled(null, 'habits', hidden)).toBe(false);
    // …and what the page asks: no location, so it renders nothing.
    expect(resolveActiveLocation(nav, 'track')).toBeNull();
    expect(resolveActiveLocation(nav, 'coach')).toBeNull();
  });

  it('the same five hidden leaves leave Coach reachable while power tools are ON', () => {
    const hidden = new Set<string>([
      'track',
      'history',
      'insights',
      'rewards',
      'challenges',
      ...flagGatedHiddenKeys({ powerTools: true }),
    ]);
    expect(isModuleEnabled(null, 'habits', hidden)).toBe(true);
    expect(getPageNavigation('habits', null, hidden).soleLeaf?.key).toBe('coach');
  });

  it('only leaves carrying a gate are affected', () => {
    const gated = new Set<NavLeafKey>(flagGatedHiddenKeys({ powerTools: false }));
    for (const key of NAV_LEAF_KEYS) {
      if (key === 'coach') continue;
      expect(gated.has(key)).toBe(false);
    }
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

  /**
   * ⚠️ REGRESSION: `isModuleEnabled` used to short-circuit to `true` whenever the
   * hidden set was empty, BEFORE deriving the page from its leaves — so it
   * disagreed with `isPlanVisible`/`getPageNavigation` for a household that had
   * turned off all three Lists sub-tabs. An empty set is not hypothetical: it is
   * exactly what a member who un-hides all five default Home widgets stores.
   */
  it('derives a page from its leaves even for an EMPTY member layer', () => {
    const allTabsOff = settings({ lists: true, todos: false, meals: false, shopping: false });
    for (const hidden of NO_HIDDEN_KEYS) {
      expect(isModuleEnabled(allTabsOff, 'lists', hidden)).toBe(false);
      // …and agrees with the two helpers built on the same derivation.
      expect(isPlanVisible(allTabsOff, hidden)).toBe(false);
      expect(getPageNavigation('lists', allTabsOff, hidden).isVisible).toBe(false);
    }
  });

  it('agrees with getPageNavigation for every page and every empty-set shape', () => {
    const cases = [settings({}), settings(undefined), settings({ todos: false, meals: false })];
    for (const s of cases) {
      for (const hidden of NO_HIDDEN_KEYS) {
        for (const page of ['habits', 'money', 'lists'] as const) {
          expect(isModuleEnabled(s, page, hidden)).toBe(
            getPageNavigation(page, s, hidden).isVisible,
          );
        }
      }
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
