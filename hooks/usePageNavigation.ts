import { useMemo } from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useHiddenVisibilityKeys } from '@/hooks/useHiddenVisibilityKeys';
import { getPageNavigation, type NavPageKey, type PageNavigation } from '@/utils/moduleVisibility';

/**
 * 2F.1 — the visible group/leaf tree for one page, composed from the household
 * layer (`moduleVisibility`) and the member layer (`hiddenKeys`).
 *
 * This is what implements the COLLAPSE RULE at the page level: when `soleLeaf`
 * is set the page has exactly one reachable view, so it renders that view with
 * no tab strip and no `TabSubViewMenu` — tapping the footer nav item simply IS
 * that view. A group with one visible leaf navigates directly instead of
 * opening its menu; a group with none disappears; a page with none is hidden
 * entirely (`isVisible === false`) and `ModuleRoute` redirects it away.
 *
 * ⚠️ There is deliberately NO per-page escape hatch for "also hide this leaf".
 * The hidden set is `useHiddenVisibilityKeys()`, the same one `ModuleRoute` and
 * `BottomNav` see through `useModuleVisibility`, and global flag gates (Habits'
 * power-tools Coach) are declared on the registry so they land in that one set.
 * Subtracting a leaf here only would make the page's reachable-leaf set narrower
 * than the nav's, which is exactly how a nav item can lead to a blank page.
 *
 * Separate from `useModuleVisibility()` on purpose: this returns fresh arrays
 * for a single page, while that hook is consumed by many always-mounted
 * components whose only question is "is this module on".
 */
export const usePageNavigation = (page: NavPageKey): PageNavigation => {
  const { householdSettings } = useHouseholdCore();
  const hidden = useHiddenVisibilityKeys();
  return useMemo(
    () => getPageNavigation(page, householdSettings, hidden),
    [page, householdSettings, hidden]
  );
};
