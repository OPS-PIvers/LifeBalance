import type { Household, HouseholdMember, ModuleKey } from '@/types/schema';
import {
  DASHBOARD_WIDGETS,
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

/**
 * GLOBAL operator flags that gate individual leaves — a THIRD reason a leaf can
 * be unreachable, outside both visibility layers.
 *
 * Declaring the gate on the registry (rather than letting each page subtract its
 * own flag-gated leaves) is what keeps "which leaves are reachable" a single
 * answer: `flagGatedHiddenKeys` folds these into the same hidden-key set the
 * member layer produces, so a flag-gated leaf takes part in the page-level
 * derivation and the collapse rule EXACTLY like a member-hidden one. Subtracting
 * one page-side only would let `BottomNav`/`ModuleRoute` offer a page whose own
 * reachable-leaf set is empty — i.e. a blank page.
 */
export interface NavFlagGates {
  /** `powerToolsEnabled` (Plan 17) — gates Habits' Coach view. */
  powerTools: boolean;
}

export interface NavLeafDef {
  key: NavLeafKey;
  label: string;
  /**
   * The household `ModuleKey` gating this leaf. Money/Habits leaves inherit
   * their page's module; Lists leaves each have their own household toggle.
   */
  module: ModuleKey;
  /** A global flag gate this leaf additionally requires (see `NavFlagGates`). */
  gate?: keyof NavFlagGates;
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
          // Power-tools-gated (Plan 17): unreachable while the global flag is
          // off, and it collapses the page the same way a member-hidden leaf does.
          { key: 'coach', label: 'Coach', module: 'habits', gate: 'powerTools' },
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

/** Leaf key → its registry entry. Total over `NavLeafKey` (pinned by a test). */
const LEAF_DEFS: ReadonlyMap<string, NavLeafDef> = new Map(
  NAV_PAGES.flatMap(p => p.groups.flatMap(g => g.leaves.map(l => [l.key, l] as const)))
);

const leafDef = (key: NavLeafKey): NavLeafDef => {
  const found = LEAF_DEFS.get(key);
  // Total over a closed union — every NavLeafKey has a registry entry above.
  if (!found) throw new Error(`Unknown nav leaf: ${key}`);
  return found;
};

/**
 * Leaf key → the page that owns it (same registry as `LEAF_DEFS`). Used by
 * `resolveLandingScreenKey` (2F.2) to map a stored `homeScreen` that names a
 * LEAF rather than a page onto that leaf's owning page — a leaf isn't a
 * standalone route, so the best a landing screen can do with one is open the
 * page that contains it.
 */
const LEAF_PAGE_KEYS: ReadonlyMap<string, NavPageKey> = new Map(
  NAV_PAGES.flatMap(p => p.groups.flatMap(g => g.leaves.map(l => [l.key, p.key] as const)))
);

/**
 * The leaf keys currently unreachable because a GLOBAL flag gate is off.
 *
 * The caller folds these into the member's hidden-key set (see
 * `hooks/useHiddenVisibilityKeys.ts`), which is what makes a flag gate ride the
 * SAME single code path as a member's own choice — one reachable-leaf set shared
 * by the pages, `BottomNav` and `ModuleRoute`.
 */
export function flagGatedHiddenKeys(gates: NavFlagGates): NavLeafKey[] {
  return [...LEAF_DEFS.values()].filter(l => l.gate && !gates[l.gate]).map(l => l.key);
}

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
// Home — member-only toggle (2F.2)
// ---------------------------------------------------------------------------

/**
 * Whether Home is enabled for this member. Unlike Habits/Money/Lists, Home has
 * no HOUSEHOLD-level toggle — it isn't a `ModuleKey` and isn't in `NAV_PAGES` —
 * so this takes only the member's hidden-key set, not `ModuleSettings`.
 */
export function isHomeVisible(hidden?: HiddenKeys): boolean {
  return !asSet(hidden).has('home');
}

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

/**
 * A single leaf's visibility looked up BY KEY, for callers that hold a leaf key
 * rather than a registry entry — e.g. global search, which must gate a result on
 * the SPECIFIC view it deep-links to, not merely on its page still having some
 * reachable view (otherwise selecting the result silently lands elsewhere).
 */
export function isNavLeafKeyVisible(
  settings: ModuleSettings,
  key: NavLeafKey,
  hidden?: HiddenKeys
): boolean {
  return isLeafVisible(settings, leafDef(key), hidden);
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
 *
 * ⚠️ The page keys route through `getPageNavigation` UNCONDITIONALLY, including
 * for an absent or empty hidden set. An "empty set ⇒ enabled" shortcut would
 * contradict the derivation for a household that has turned off every Lists
 * sub-tab: `getPageNavigation('lists', …).isVisible` and `isPlanVisible` both
 * (correctly) say false, and this must agree with them. An empty hidden set is
 * not hypothetical — it is exactly what a member who un-hides all five default
 * Home widgets ends up with.
 */
export function isModuleEnabled(
  settings: ModuleSettings,
  key: ModuleKey,
  hidden?: HiddenKeys
): boolean {
  if (!isHouseholdModuleEnabled(settings, key)) return false;
  switch (key) {
    case 'habits':
    case 'money':
    case 'lists':
      return getPageNavigation(key, settings, hidden).isVisible;
    default:
      return !asSet(hidden).has(key);
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

// ---------------------------------------------------------------------------
// Admin matrix (2F.3) — the pure row/lock derivation behind
// components/settings/MemberVisibilityMatrix.tsx.
//
// The matrix renders ONE row per `VisibilityKey`, grouped exactly like
// `NAV_PAGES` (plus a Home-widgets group), with the household layer surfaced
// as the group's own toggle (and, for Lists' three sub-tabs, an additional
// per-row toggle — each of `todos`/`meals`/`shopping` is independently
// household-gated, unlike Habits'/Money's leaves which all share their page's
// single module). There is no separate household concept for Home widgets.
// ---------------------------------------------------------------------------

export interface VisibilityMatrixRow {
  key: VisibilityKey;
  label: string;
  /**
   * Set only when this SPECIFIC row has its OWN household `ModuleKey`,
   * distinct from its section's — i.e. Lists' `todos`/`meals`/`shopping`.
   * `null` for rows governed solely by the section's module (Habits/Money
   * leaves) or not household-gated at all (Home widgets).
   */
  ownModule: ModuleKey | null;
}

export interface VisibilityMatrixSection {
  key: NavPageKey | 'widgets';
  label: string;
  /** The household module this section's own toggle governs; `null` for Home widgets (no household concept). */
  moduleKey: ModuleKey | null;
  rows: readonly VisibilityMatrixRow[];
}

/**
 * The full matrix, derived from `NAV_PAGES` (leaves) plus `DASHBOARD_WIDGETS`
 * — no hand-authored row list to drift from the single nav registry.
 */
export function getVisibilityMatrixSections(): VisibilityMatrixSection[] {
  const pageSections: VisibilityMatrixSection[] = NAV_PAGES.map(page => ({
    key: page.key,
    label: page.label,
    moduleKey: page.module,
    rows: page.groups.flatMap(group =>
      group.leaves.map(leaf => ({
        key: leaf.key,
        label: leaf.label,
        ownModule: leaf.module !== page.module ? leaf.module : null,
      }))
    ),
  }));

  const widgetSection: VisibilityMatrixSection = {
    key: 'widgets',
    label: 'Home widgets',
    moduleKey: null,
    rows: DASHBOARD_WIDGETS.map(widget => ({
      key: widget.id,
      label: widget.label,
      ownModule: null,
    })),
  };

  return [...pageSections, widgetSection];
}

/**
 * Whether a matrix row is unreachable at the HOUSEHOLD level — i.e. no
 * member's cell in this row can be made "on" regardless of their own
 * `hiddenKeys`, because either the section's module or (for Lists' sub-tabs)
 * the row's own module is off. This is what the admin matrix uses to grey a
 * whole row and stop a per-member switch from reading as live.
 */
export function isMatrixRowLocked(
  settings: ModuleSettings,
  section: Pick<VisibilityMatrixSection, 'moduleKey'>,
  row: Pick<VisibilityMatrixRow, 'ownModule'>
): boolean {
  if (section.moduleKey && !isHouseholdModuleEnabled(settings, section.moduleKey)) return true;
  if (row.ownModule && !isHouseholdModuleEnabled(settings, row.ownModule)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Landing route (2F.2)
// ---------------------------------------------------------------------------

/** A destination `resolveLandingRoute` can land a member on: Home or a nav page. */
export type LandingScreenKey = HomeKey | NavPageKey;

/** The member slice `resolveLandingScreenKey`/`resolveLandingRoute` read. */
export type LandingMember = Pick<HouseholdMember, 'homeScreen'> | null | undefined;

/** Canonical landing candidates in resolution order: Home, then pages in registry order. */
const LANDING_CANDIDATES: readonly { key: LandingScreenKey; path: string }[] = [
  { key: 'home', path: '/' },
  ...NAV_PAGES.map(p => ({ key: p.key, path: p.path })),
];

const isLandingKeyVisible = (
  key: LandingScreenKey,
  settings: ModuleSettings,
  hidden: HiddenKeys
): boolean => (key === 'home' ? isHomeVisible(hidden) : getPageNavigation(key, settings, hidden).isVisible);

/**
 * Maps an arbitrary stored `homeScreen` string onto a landing key that is
 * CURRENTLY reachable, or `null` if it doesn't resolve to anything visible.
 *
 * `firestore.rules` validates `homeScreen` only as "a short string" (≤64
 * chars), so it may name: `'home'`; a `NavPageKey` (`'habits'` / `'money'` /
 * `'lists'`); a `NavLeafKey` (e.g. `'buckets'`) — not offered by `MyViewSettings`
 * today, but defensively resolved to its OWNING page since a leaf isn't a
 * standalone route; or an unknown/stale string, which resolves to `null`.
 */
const resolveHomeScreenKey = (
  homeScreen: string,
  settings: ModuleSettings,
  hidden: HiddenKeys
): LandingScreenKey | null => {
  const direct = LANDING_CANDIDATES.find(c => c.key === homeScreen)?.key;
  const key = direct ?? LEAF_PAGE_KEYS.get(homeScreen);
  if (!key) return null;
  return isLandingKeyVisible(key, settings, hidden) ? key : null;
};

/**
 * Resolve a member's effective landing screen KEY (2F.2): their CHOSEN
 * `homeScreen` → the FIRST enabled nav destination (Home, then Habits/Money/
 * Lists in registry order) → `'settings'`. This chain guarantees a result even
 * when every page is hidden — Settings is the terminal fallback precisely
 * because it is structurally un-hideable (absent from `VisibilityKey` and from
 * `NAV_PAGES`, the lockout guard).
 *
 * Handles, explicitly: `homeScreen` naming a page the member has since hidden,
 * or one the HOUSEHOLD has since disabled (both fall through to the next link
 * in the chain via `isLandingKeyVisible`); `homeScreen` naming a leaf rather
 * than a page (resolved to its owning page by `resolveHomeScreenKey`);
 * `homeScreen` absent entirely (skips straight to the fallback chain, so an
 * un-customized member lands on Home exactly as before this field existed);
 * and every page hidden at once (falls all the way through to `'settings'`).
 *
 * Exported for `MyViewSettings`, which needs the KEY (not a route path) to
 * drive its landing-screen picker and to show the CURRENTLY effective choice.
 * `resolveLandingRoute` below is the same resolution expressed as a path.
 */
export function resolveLandingScreenKey(
  member: LandingMember,
  settings: ModuleSettings,
  hidden: HiddenKeys
): LandingScreenKey | 'settings' {
  const requested = member?.homeScreen;
  const resolved = requested ? resolveHomeScreenKey(requested, settings, hidden) : null;
  if (resolved) return resolved;
  const fallback = LANDING_CANDIDATES.find(c => isLandingKeyVisible(c.key, settings, hidden));
  return fallback?.key ?? 'settings';
}

/**
 * Resolve a member's effective landing screen as a ROUTE PATH — the app-level
 * answer to "where does this member land when they open the app": the `/`
 * route guard (`HomeRoute`) redirects here whenever Home itself is hidden.
 */
export function resolveLandingRoute(
  member: LandingMember,
  settings: ModuleSettings,
  hidden: HiddenKeys
): string {
  const key = resolveLandingScreenKey(member, settings, hidden);
  if (key === 'settings') return '/settings';
  // Total over `LANDING_CANDIDATES` by construction — `key` came from either a
  // literal entry in that array or its `'settings'` sentinel, handled above.
  return LANDING_CANDIDATES.find(c => c.key === key)?.path ?? '/settings';
}
