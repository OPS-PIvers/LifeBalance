import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import SearchOverlay from './SearchOverlay';
import {
  useFinance,
  useGamification,
  useMealPlan,
  useShopping,
  useTodos,
  useHouseholdCore,
} from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useGamification: vi.fn(),
  useMealPlan: vi.fn(),
  useShopping: vi.fn(),
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

const transactions = [
  { id: 'tx-1', amount: 42, merchant: 'Target', category: 'Shopping', date: '2026-07-01', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false },
];
// A row whose bank descriptor shares no words with the friendly name a
// merchant rule gives it — the case merchant-rule-aware search exists for.
const coffeeTransaction = {
  id: 'tx-coffee', amount: 5.25, merchant: 'SQ *BLUE BOTTLE', category: 'Dining', date: '2026-07-01', status: 'verified', isRecurring: false, source: 'manual', autoCategorized: false,
};
const habits = [
  { id: 'habit-1', title: 'Read 30 mins', category: 'Wellness', type: 'positive', basePoints: 10, scoringType: 'threshold', period: 'daily', targetCount: 1, count: 0, totalCount: 0, completedDates: [], streakDays: 0, lastUpdated: '2026-07-01' },
];
const meals = [{ id: 'meal-1', name: 'Taco Tuesday', ingredients: [], tags: ['favorite'] }];
const todos = [{ id: 'todo-1', text: 'Take out the trash', completeByDate: '2026-07-10', assignedTo: 'uid-1', isCompleted: false, createdBy: 'uid-1', createdAt: '2026-07-01T00:00:00.000Z' }];
const shoppingList = [{ id: 'shop-1', name: 'Tostadas', category: 'Bakery', isPurchased: false }];

// Displays the current route so navigation can be asserted without mocking
// useNavigate directly.
const LocationProbe: React.FC = () => {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname} | {JSON.stringify(location.state)}
    </div>
  );
};

const renderOverlay = (isOpen = true) => {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SearchOverlay isOpen={isOpen} onClose={onClose} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
  return { onClose };
};

describe('SearchOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(useFinance).mockReturnValue({ transactions } as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue({ habits } as unknown as ReturnType<typeof useGamification>);
    vi.mocked(useMealPlan).mockReturnValue({ meals } as unknown as ReturnType<typeof useMealPlan>);
    vi.mocked(useShopping).mockReturnValue({ shoppingList } as unknown as ReturnType<typeof useShopping>);
    vi.mocked(useTodos).mockReturnValue({ todos } as unknown as ReturnType<typeof useTodos>);
    vi.mocked(useHouseholdCore).mockReturnValue({ householdSettings: null } as unknown as ReturnType<typeof useHouseholdCore>);
  });

  it('shows no results before typing a query', () => {
    renderOverlay();
    expect(screen.queryByText('Target')).not.toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
  });

  it('finds a matching transaction, habit, meal, todo, and shopping item', () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'ta' } });

    expect(screen.getByText('Target')).toBeInTheDocument();
    expect(screen.getByText('Taco Tuesday')).toBeInTheDocument();
    expect(screen.getByText('Take out the trash')).toBeInTheDocument();
    expect(screen.getByText('Tostadas')).toBeInTheDocument();
  });

  it('announces the result count via the polite live region', () => {
    renderOverlay();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent('');

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'ta' } });
    expect(liveRegion).toHaveTextContent(/^\d+ results?$/);

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'zzzzz' } });
    expect(liveRegion).toHaveTextContent('No results');
  });

  it('shows a compact empty state when nothing matches', () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'zzzzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('excludes results from a disabled module', () => {
    vi.mocked(useHouseholdCore).mockReturnValue({
      householdSettings: { moduleVisibility: { money: false } },
    } as unknown as ReturnType<typeof useHouseholdCore>);
    renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'ta' } });
    expect(screen.queryByText('Target')).not.toBeInTheDocument();
    expect(screen.getByText('Taco Tuesday')).toBeInTheDocument();
  });

  it('navigates to /budget with the transactions tab, a highlightId, and closes on select', () => {
    const { onClose } = renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'Target' } });
    fireEvent.click(screen.getByText('Target'));

    expect(screen.getByTestId('location-probe').textContent).toBe(
      '/budget | {"tab":"transactions","highlightId":"tx-1"}'
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to /habits with the track tab and a highlightId on select', () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'Read' } });
    fireEvent.click(screen.getByText('Read 30 mins'));

    expect(screen.getByTestId('location-probe').textContent).toBe(
      '/habits | {"tab":"track","highlightId":"habit-1"}'
    );
  });

  it('finds a transaction by the friendly name a merchant rule gives it', () => {
    vi.mocked(useFinance).mockReturnValue({
      transactions: [coffeeTransaction],
    } as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useHouseholdCore).mockReturnValue({
      householdSettings: {
        merchantRules: [
          { id: 'rule-1', pattern: 'SQ *BLUE BOTTLE', name: 'Coffee run', createdAt: '2026-07-01T00:00:00.000Z' },
        ],
      },
    } as unknown as ReturnType<typeof useHouseholdCore>);
    renderOverlay();

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'coffee' } });
    // Found by the friendly name, and presented under it.
    expect(screen.getByText('Coffee run')).toBeInTheDocument();
    expect(screen.queryByText('SQ *BLUE BOTTLE')).not.toBeInTheDocument();

    // The raw descriptor still FINDS it — matching is wider than display — but
    // the row is still labelled with the name the household chose.
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'blue bottle' } });
    expect(screen.getByText('Coffee run')).toBeInTheDocument();
  });

  it('does not match a friendly name when the household has no merchant rules', () => {
    vi.mocked(useFinance).mockReturnValue({
      transactions: [coffeeTransaction],
    } as unknown as ReturnType<typeof useFinance>);
    renderOverlay();

    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'coffee' } });
    expect(screen.queryByText('SQ *BLUE BOTTLE')).not.toBeInTheDocument();
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('navigates to /lists and seeds the shopping tab on select', () => {
    renderOverlay();
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'Tostadas' } });
    fireEvent.click(screen.getByText('Tostadas'));

    expect(screen.getByTestId('location-probe').textContent).toBe('/lists | null');
    expect(window.localStorage.getItem('lists-active-tab')).toBe('shopping');
  });
});
