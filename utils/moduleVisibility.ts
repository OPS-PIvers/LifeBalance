import type { Household, HouseholdMember, ModuleKey } from '@/types/schema';
import {
  DEFAULT_HIDDEN_DASHBOARD_WIDGETS,
  type DashboardWidgetId,
} from '@/utils/dashboardLayout';

/**
 * Per-household + per-member visibility (Plan 090 → 2F.1).
 *
 * TWO layers, composed with `&&`:
 *
 * - **Household** (`Household.moduleVisibility`, keyed by `ModuleKey`) — "does
 *   this household use it at all." Fail-open, all-on by default, and what a new
 *   member inherits.
 * - **Member** (`HouseholdMember.hiddenKeys`, keyed by `VisibilityKey`) — "do I
 *   want it in my nav." LEAVES ONLY; groups and pages are DERIVED — a group
 *   disappears when all its leaves are off, a page when all its groups are.
 *
 * An admin editing a member edits the SAME field the member edits for
 * themselves — last write wins, no third precedence layer.
 *
 * Settings is deliberately absent from `VisibilityKey` AND from `NAV_PAGES`, so
 * it is structurally impossible to hide (the lockout guard) rather than merely
 * omitted from some list.
 */

/**
 * The slice of household settings the module-visibility helpers read. Accepts
 * the full Household, a `Pick`ed shape, or null/undefined (during cold load)
 * — every case fails open to "enabled".
 */
export type ModuleSettings = Pick<Household, 'moduleVisibility'> | null | undefined;

// ---------------------------------------------------------------------------
// Key set — LEAVES ONLY
// ---------------------------------------------------------------------------

/** Reserved for 2F.2 (Home becomes toggleable); no toggle is exposed for it yet. */
export type HomeKey = 'home';

/** Habits page leaves (see `HABIT_TABS` in pages/Habits.tsx). */
export type HabitsLeafKey = 'track' | 'history' | 'insights' | 'coach' | 'rewards' | 'challenges';

/** Money page leaves (see `MONEY_TABS` in pages/Budget.tsx). */
export type MoneyLeafKey =
  | 'overview'
  | 'transactions'
  | 'trends'
  | 'calendar'
  | 'subscriptions'
  | 'buckets'
  | 'accounts';

/** Lists page leaves — these are `ModuleKey`s too, so the household can hide them as well. */
export type ListsLeafKey = 'todos' | 'meals' | 'shopping';

/** Every navigable leaf across the three toggleable pages. */
export type NavLeafKey = HabitsLeafKey | MoneyLeafKey | ListsLeafKey;

/** The unified per-member key set: Home + nav leaves + Home widgets. */
export type VisibilityKey = HomeKey | NavLeafKey | DashboardWidgetId;

/**
 * A Lists sub-tab key. Named `PlanTab` since Plan 090 and kept under that name
 * because it is the parameter type of `isPlanTabVisible`, used across the app.
 */
export type PlanTab = ListsLeafKey;

// ---------------------------------------------------------------------------
// Nav registry — the derivation source for groups, pages, and the collapse rule
// ---------------------------------------------------------------------------

/** The three toggleable footer pages (Home and Settings are not in this set). */
export type NavPageKey = 'habits' | 'money' | 'lists';

export interface NavLeafDef {
  key: NavLeafKey;
  label: string;
  /**
   * The household `ModuleKey` gating this leaf. Money/Habits leaves inherit
   * their page's module; Lists leaves each have their own household toggle.
   */
  module: ModuleKey;
}

export interface NavGroupDef {
  /** The tab value anchoring this group in the page's tab strip. */
  key: string;
  label: string;
  leaves: readonly NavLeafDef[];
}

export interface NavPageDef {
  key: NavPageKey;
  label: string;
  path: string;
  /** The household module gating the whole page. */
  module: ModuleKey;
  groups: readonly NavGroupDef[];
}

/**
 * The canonical page → group → leaf tree. Group keys and leaf keys MUST stay
 * identical to the tab values the pages use (`MONEY_TABS` / `HABIT_TABS`) —
 * the pages drive their tab strips off this registry.
 */
export const NAV_PAGES: readonly NavPageDef[] = [
  {
    key: 'habits',
    label: 'Habits',
    path: '/habits',
    module: 'habits',
    groups: [
      { key: 'track', label: 'Track', leaves: [{ key: 'track', label: 'Track', module: 'habits' }] },
      {
        key: 'progress',
        label: 'Progress',
        leaves: [
          { key: 'history', label: 'History', module: 'habits' },
          { key: 'insights', label: 'Insights', module: 'habits' },
          { key: 'coach', label: 'Coach', module: 'habits' },
        ],
      },
      {
        key: 'rewards',
        label: 'Rewards',
        leaves: [
          { key: 'rewards', label: 'Store', module: 'habits' },
          { key: 'challenges', label: 'Challenges', module: 'habits' },
        ],
      },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    path: '/budget',
    module: 'money',
    groups: [
      {
        key: 'overview',
        label: 'Overview',
        leaves: [{ key: 'overview', label: 'Overview', module: 'money' }],
      },
      {
        key: 'activity',
        label: 'Activity',
        leaves: [
          { key: 'transactions', label: 'Transactions', module: 'money' },
          { key: 'trends', label: 'Trends', module: 'money' },
        ],
      },
      {
        key: 'planned',
        label: 'Planned',
        leaves: [
          { key: 'calendar', label: 'Calendar', module: 'money' },
          { key: 'subscriptions', label: 'Subscriptions', module: 'money' },
        ],
      },
      {
        key: 'balances',
        label: 'Budget',
        leaves: [
          { key: 'buckets', label: 'Buckets', module: 'money' },
          { key: 'accounts', label: 'Accounts', module: 'money' },
        ],
      },
    ],
  },
  {
    key: 'lists',
    label: 'Lists',
    path: '/lists',
    module: 'lists',
    // Lists has a flat tab strip — every group holds exactly one leaf, so its
    // tabs are always direct (no sub-view menu). The collapse rule below
    // reproduces that without special-casing the page.
    groups: [
      { key: 'todos', label: 'To-Dos', leaves: [{ key: 'todos', label: 'To-Dos', module: 'todos' }] },
      { key: 'meals', label: 'Meals', leaves: [{ key: 'meals', label: 'Meals', module: 'meals' }] },
      {
        key: 'shopping',
        label: 'Shopping',
        leaves: [{ key: 'shopping', label: 'Shopping', module: 'shopping' }],
      },
    ],
  },
];

const pageDef = (page: NavPageKey): NavPageDef => {
  const found = NAV_PAGES.find(p => p.key === page);
  // Total over a closed union — every NavPageKey has an entry above (pinned by
  // a unit test), so this is unreachable rather than a silent fallback.
  if (!found) throw new Error(`Unknown nav page: ${page}`);
  return found;
};

/** Every nav leaf key, in canonical page → group → leaf order. */
export const NAV_LEAF_KEYS: readonly NavLeafKey[] = NAV_PAGES.flatMap(p =>
  p.groups.flatMap(g => g.leaves.map(l => l.key))
);

// ---------------------------------------------------------------------------
// Member layer — resolution
// ---------------------------------------------------------------------------

/** The member slice the visibility helpers read (null/undefined during cold load). */
export type MemberVisibility =
  | Pick<HouseholdMember, 'hiddenKeys' | 'dashboardHidden'>
  | null
  | undefined;

/**
 * What a member who has never customized anything gets: ONLY the five
 * default-hidden Home widgets.
 *
 * ⚠️ This one constant is what reconciles the two systems' OPPOSITE defaults.
 * `moduleVisibility` fails OPEN (only an explicit `false` disables) while the
 * pre-2F.1 `resolveHiddenWidgets` failed CLOSED (an absent list means five
 * widgets hidden). Since a key is visible unless it is IN the hidden list, and
 * this default list contains no nav leaves, PAGES keep failing open while
 * WIDGETS stay hidden exactly as before — and no migration runs.
 */
export const MEMBER_DEFAULT_HIDDEN_KEYS: readonly VisibilityKey[] = DEFAULT_HIDDEN_DASHBOARD_WIDGETS;

/**
 * A member's effective hidden-key list.
 *
 * `hiddenKeys` (2F.1) wins; the pre-2F.1 widget-only `dashboardHidden` is READ
 * as a fallback so members who customized their Home widgets before 2F.1 keep
 * those choices without a data migration; otherwise the lean default above. An
 * explicit empty list always wins over the default.
 */
export function resolveHiddenKeys(member: MemberVisibility): readonly string[] {
  return member?.hiddenKeys ?? member?.dashboardHidden ?? MEMBER_DEFAULT_HIDDEN_KEYS;
}

/** Convenience: the resolved hidden list as a Set, ready for the helpers below. */
export function resolveHiddenKeySet(member: MemberVisibility): ReadonlySet<string> {
  return new Set(resolveHiddenKeys(member));
}

/** Toggle a visibility key's membership in a hidden list. */
export function toggleHiddenKey(
  hidden: readonly string[] | undefined,
  key: VisibilityKey
): string[] {
  const set = new Set(hidden ?? []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set];
}

/**
 * The member layer as accepted by the helpers below. `undefined`/`null` means
 * "no member scoping" — the household layer alone decides, which is the
 * pre-2F.1 behavior and keeps every un-migrated call site correct.
 */
export type HiddenKeys = ReadonlySet<string> | readonly string[] | null | undefined;

const EMPTY_HIDDEN: ReadonlySet<string> = new Set<string>();

const asSet = (hidden: HiddenKeys): ReadonlySet<string> => {
  if (hidden == null) return EMPTY_HIDDEN;
  return hidden instanceof Set ? hidden : new Set(hidden);
};

// ---------------------------------------------------------------------------
// Household layer
// ---------------------------------------------------------------------------

/**
 * The household layer alone. FAIL-OPEN: an absent settings object, an absent
 * `moduleVisibility` map, or an absent key all mean ENABLED.
 *
 * `'lists'` reads through the legacy `'plan'` key (the 2F.1 rename) so
 * households that saved a Plan toggle before the rename keep it. Read-time
 * alias only — `'plan'` is never written back, and an explicit `lists` value
 * always wins over it.
 */
export function isHouseholdModuleEnabled(settings: ModuleSettings, key: ModuleKey): boolean {
  const map = settings?.moduleVisibility;
  if (key === 'lists') return (map?.lists ?? map?.plan) !== false;
  return map?.[key] !== false;
}

// ---------------------------------------------------------------------------
// Composed layer — what the app renders off
// ---------------------------------------------------------------------------

export interface VisibleGroup {
  key: string;
  label: string;
  leaves: NavLeafDef[];
}

export interface PageNavigation {
  /** Every leaf this member can reach on the page, in canonical order. */
  leaves: NavLeafDef[];
  /** Groups that retain at least one visible leaf. */
  groups: VisibleGroup[];
  /** False when the page has no reachable leaf — hide its nav item and route. */
  isVisible: boolean;
  /**
   * COLLAPSE RULE — the page's only reachable leaf, when there is exactly one.
   * Callers render that leaf directly: no tab strip, no `TabSubViewMenu`, and
   * the footer nav item is effectively a direct link to that view.
   */
  soleLeaf: NavLeafDef | null;
}

/** A single leaf's visibility: household module on AND the member hasn't hidden it. */
export function isLeafVisible(
  settings: ModuleSettings,
  leaf: NavLeafDef,
  hidden?: HiddenKeys
): boolean {
  return isHouseholdModuleEnabled(settings, leaf.module) && !asSet(hidden).has(leaf.key);
}

/** Resolve a page's visible group/leaf tree plus its collapse state. */
export function getPageNavigation(
  page: NavPageKey,
  settings: ModuleSettings,
  hidden?: HiddenKeys
): PageNavigation {
  const def = pageDef(page);
  const hiddenSet = asSet(hidden);
  const groups: VisibleGroup[] = [];
  const leaves: NavLeafDef[] = [];

  if (isHouseholdModuleEnabled(settings, def.module)) {
    for (const group of def.groups) {
      const visible = group.leaves.filter(leaf => isLeafVisible(settings, leaf, hiddenSet));
      if (visible.length > 0) {
        groups.push({ key: group.key, label: group.label, leaves: visible });
        leaves.push(...visible);
      }
    }
  }

  return {
    leaves,
    groups,
    isVisible: leaves.length > 0,
    soleLeaf: leaves.length === 1 ? (leaves[0] ?? null) : null,
  };
}

/** A visible {group, leaf} pair — the full location of a page's current view. */
export interface ActiveLocation {
  /** The group key, i.e. the page's selected tab value. */
  group: string;
  /** The leaf key, i.e. the view actually rendered. */
  leaf: string;
}

/**
 * Resolve a requested tab value to a location that is actually visible.
 *
 * `requested` may be a leaf key (deep link straight to a view), a group key
 * (the tab was entered via its top-level trigger), or something stale/hidden —
 * a leaf the member has since turned off, or a legacy key. In every case the
 * result is a visible location: the leaf itself, else the group's first
 * visible leaf, else the page's first visible leaf. Returns null only when the
 * page has no visible leaf at all (its route is redirected away by then).
 */
export function resolveActiveLocation(
  nav: PageNavigation,
  requested: string
): ActiveLocation | null {
  const owning = nav.groups.find(g => g.leaves.some(l => l.key === requested));
  if (owning) return { group: owning.key, leaf: requested };

  const asGroup = nav.groups.find(g => g.key === requested);
  const fallback = asGroup ?? nav.groups[0];
  const leaf = fallback?.leaves[0];
  if (!fallback || !leaf) return null;
  return { group: fallback.key, leaf: leaf.key };
}

/**
 * Whether a module is enabled for this member. Page keys (`habits`, `money`,
 * `lists`) are DERIVED — they report false once every one of their leaves is
 * gone — while the Lists sub-tab keys are leaves in their own right.
 */
export function isModuleEnabled(
  settings: ModuleSettings,
  key: ModuleKey,
  hidden?: HiddenKeys
): boolean {
  if (!isHouseholdModuleEnabled(settings, key)) return false;
  const hiddenSet = asSet(hidden);
  if (hiddenSet.size === 0) return true;
  switch (key) {
    case 'habits':
    case 'money':
    case 'lists':
      return getPageNavigation(key, settings, hiddenSet).isVisible;
    default:
      return !hiddenSet.has(key);
  }
}

/**
 * Whether the Lists footer page (and its `/lists` route) should be visible: the
 * household's Lists toggle on AND at least one sub-tab reachable by this member
 * — otherwise the page would render an empty tab strip, so it auto-hides.
 */
export function isPlanVisible(settings: ModuleSettings, hidden?: HiddenKeys): boolean {
  return getPageNavigation('lists', settings, hidden).isVisible;
}

/**
 * Whether a specific Lists sub-tab is visible. The Lists master toggle gates
 * every sub-tab, so turning Lists off hides all tabs regardless of their
 * individual flags; the member's own hidden list gates it on top of that.
 */
export function isPlanTabVisible(
  settings: ModuleSettings,
  tab: PlanTab,
  hidden?: HiddenKeys
): boolean {
  return (
    isHouseholdModuleEnabled(settings, 'lists') &&
    isHouseholdModuleEnabled(settings, tab) &&
    !asSet(hidden).has(tab)
  );
}
