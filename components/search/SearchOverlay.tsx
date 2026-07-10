import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Receipt, Star, UtensilsCrossed, CheckSquare, ShoppingCart } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import { Section, SurfaceList, DisclosureRow } from '@/components/ui/Section';
import { useFinance, useGamification, useMealPlan, useShopping, useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { searchAll, type GlobalSearchEntityType, type GlobalSearchNavTarget, type GlobalSearchResult } from '@/utils/globalSearch';

interface SearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<GlobalSearchEntityType, string> = {
  transaction: 'Transactions',
  habit: 'Habits',
  meal: 'Meals',
  todo: 'To-Dos',
  shopping: 'Shopping',
};

const TYPE_ICONS: Record<GlobalSearchEntityType, React.ReactNode> = {
  transaction: <Receipt size={18} aria-hidden="true" />,
  habit: <Star size={18} aria-hidden="true" />,
  meal: <UtensilsCrossed size={18} aria-hidden="true" />,
  todo: <CheckSquare size={18} aria-hidden="true" />,
  shopping: <ShoppingCart size={18} aria-hidden="true" />,
};

// Canonical grouping/display order — stable regardless of match order.
const TYPE_ORDER: GlobalSearchEntityType[] = ['transaction', 'habit', 'todo', 'meal', 'shopping'];

/**
 * Navigates to a search result's target page/tab. `/budget` and `/habits`
 * use the `useDeepLinkTab` convention (`state: { tab }`); `/lists` has no such
 * param, so the target sub-tab is seeded into the `lists-active-tab`
 * localStorage key first, mirroring `PlanTabRedirect`
 * (`components/auth/PlanTabRedirect.tsx`). None of the four pages support
 * filtering to a single record yet (see the plan's Spike notes), so this is a
 * page/tab-level jump, not a record-level one.
 */
function navigateToResult(navigate: ReturnType<typeof useNavigate>, nav: GlobalSearchNavTarget): void {
  if (nav.path === '/lists') {
    try {
      window.localStorage.setItem('lists-active-tab', nav.listsTab ?? 'todos');
    } catch {
      /* best-effort */
    }
    navigate('/lists');
    return;
  }
  navigate(nav.path, { state: { tab: nav.tab } });
}

/**
 * Lazy-loaded global search overlay (Plan 14) — a `Drawer` with an autofocused
 * search field over the household's already-loaded in-memory slices
 * (transactions, habits, meals, todos, shopping items). Pure matching/ranking
 * lives in `utils/globalSearch.ts`; this component only owns UI state and
 * navigation. Consumes its own slices (rather than TopToolbar consuming them)
 * so the always-mounted toolbar stays on its narrow slices.
 */
const SearchOverlay: React.FC<SearchOverlayProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const { transactions } = useFinance();
  const { habits } = useGamification();
  const { meals } = useMealPlan();
  const { shoppingList } = useShopping();
  const { todos } = useTodos();
  const { householdSettings } = useHouseholdCore();

  const results = useMemo(
    () =>
      searchAll(
        { transactions, habits, meals, todos, shoppingItems: shoppingList },
        query,
        householdSettings
      ),
    [transactions, habits, meals, todos, shoppingList, householdSettings, query]
  );

  const grouped = useMemo(() => {
    const map = new Map<GlobalSearchEntityType, GlobalSearchResult[]>();
    for (const result of results) {
      const existing = map.get(result.type);
      if (existing) {
        existing.push(result);
      } else {
        map.set(result.type, [result]);
      }
    }
    return map;
  }, [results]);

  const handleSelect = (result: GlobalSearchResult) => {
    navigateToResult(navigate, result.nav);
    onClose();
  };

  const handleClose = () => {
    setQuery('');
    onClose();
  };

  const trimmedQuery = query.trim();

  return (
    <Drawer isOpen={isOpen} onClose={handleClose} title="Search" height="tall">
      <div className="space-y-4">
        <Input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transactions, habits, meals, to-dos…"
          icon={<SearchIcon size={18} aria-hidden="true" />}
          // Distinct from the Drawer's own "Search" title (labelled via
          // aria-labelledby) so `getByLabelText('Search')` in tests — and any
          // AT navigating by label — doesn't ambiguously match both.
          aria-label="Search query"
        />

        {trimmedQuery && results.length === 0 && (
          <EmptyState
            size="compact"
            icon={<SearchIcon size={18} aria-hidden="true" />}
            title="No matches"
            description={`Nothing found for "${trimmedQuery}".`}
          />
        )}

        {TYPE_ORDER.filter((type) => grouped.has(type)).map((type) => (
          <Section key={type} title={TYPE_LABELS[type]}>
            <SurfaceList>
              {(grouped.get(type) ?? []).map((result) => (
                <DisclosureRow
                  key={result.id}
                  icon={TYPE_ICONS[result.type]}
                  title={result.title}
                  subtitle={result.subtitle}
                  onClick={() => handleSelect(result)}
                />
              ))}
            </SurfaceList>
          </Section>
        ))}
      </div>
    </Drawer>
  );
};

export default SearchOverlay;
