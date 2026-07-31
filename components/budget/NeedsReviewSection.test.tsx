import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NeedsReviewSection from './NeedsReviewSection';
import { useActionQueueTriage } from '@/hooks/useActionQueueTriage';

// The context slices are only reached transitively (the real
// `isTransactionQueueItem` guard lives in `useActionQueue`, which imports
// them), so stub the module so Firebase never initializes — same recipe as
// pages/Dashboard.test.tsx.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ transactions: [] }),
  useTodos: () => ({}),
  useHouseholdCore: () => ({}),
  useGamification: () => ({ habits: [] }),
  useExpandedCalendarItems: () => [],
}));

// The triage hook is the section's only data source; each test seeds the queue.
vi.mock('@/hooks/useActionQueueTriage', () => ({
  useActionQueueTriage: vi.fn(),
}));

// Stub the heavy card (Drawer/framer/swipe rail) to a marker div that records
// the props it received, so the selection-disabled assertions can read them.
const receivedCardProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/dashboard/ActionQueueItem', () => ({
  ActionQueueItemCard: (props: { item: { id: string } } & Record<string, unknown>) => {
    receivedCardProps.push(props);
    return <div data-testid="queue-item">{props.item.id}</div>;
  },
}));

type SeedItem = { id: string; queueType: 'transaction' | 'calendar' | 'todo'; date: string };

const tx = (id: string): SeedItem => ({ id, queueType: 'transaction', date: '2026-07-01' });
const bill = (id: string): SeedItem => ({ id, queueType: 'calendar', date: '2026-07-01' });
const todo = (id: string): SeedItem => ({ id, queueType: 'todo', date: '2026-07-01' });

const onOpenPaySheet = vi.fn();

/** Seed the mocked triage hook with a queue; everything else is inert. */
const seedQueue = (actionQueue: SeedItem[]) => {
  vi.mocked(useActionQueueTriage).mockReturnValue({
    actionQueue,
    expandedId: null,
    setExpandedId: vi.fn(),
    payModal: null,
    setPayModal: vi.fn(),
    openPaySheet: vi.fn(),
    approveDetails: new Map<string, string>(),
    handleSwipeApprove: vi.fn(),
    handleSwipeDefer: vi.fn(),
    cardProps: {
      buckets: [],
      transactions: [],
      members: [],
      updateToDo: vi.fn(),
      deleteToDo: vi.fn(),
      completeToDo: vi.fn(),
      deferCalendarItem: vi.fn(),
      deleteCalendarItem: vi.fn(),
      deleteTransaction: vi.fn(),
    },
  } as unknown as ReturnType<typeof useActionQueueTriage>);
};

const renderSection = () => render(<NeedsReviewSection onOpenPaySheet={onOpenPaySheet} />);

const queueItemIds = () => screen.queryAllByTestId('queue-item').map(el => el.textContent);

describe('NeedsReviewSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    receivedCardProps.length = 0;
  });

  it('renders nothing when the queue is empty', () => {
    seedQueue([]);
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: /needs review/i })).not.toBeInTheDocument();
  });

  it('renders nothing when the queue holds only calendar and to-do items', () => {
    seedQueue([bill('b1'), todo('t1'), bill('b2')]);
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { name: /needs review/i })).not.toBeInTheDocument();
    expect(queueItemIds()).toEqual([]);
  });

  it('renders exactly the transaction subset, in queue order', () => {
    seedQueue([bill('b1'), tx('tx1'), todo('t1'), tx('tx2'), bill('b2'), tx('tx3')]);
    renderSection();
    expect(queueItemIds()).toEqual(['tx1', 'tx2', 'tx3']);
  });

  it('counts only the transaction items in the heading', () => {
    seedQueue([bill('b1'), tx('tx1'), todo('t1'), tx('tx2')]);
    renderSection();
    expect(screen.getByRole('heading', { name: 'Needs review (2)' })).toBeInTheDocument();
  });

  it('caps the list at 5 and reveals the rest via the show-more row', () => {
    seedQueue([tx('tx1'), tx('tx2'), tx('tx3'), tx('tx4'), tx('tx5'), tx('tx6'), tx('tx7')]);
    renderSection();

    // Heading still reports the FULL count — the cap is display-only.
    expect(screen.getByRole('heading', { name: 'Needs review (7)' })).toBeInTheDocument();
    expect(queueItemIds()).toEqual(['tx1', 'tx2', 'tx3', 'tx4', 'tx5']);

    const showMore = screen.getByRole('button', { name: '+ 2 more transactions' });
    fireEvent.click(showMore);

    expect(queueItemIds()).toEqual(['tx1', 'tx2', 'tx3', 'tx4', 'tx5', 'tx6', 'tx7']);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument();
  });

  it('omits the show-more row when nothing is hidden', () => {
    seedQueue([tx('tx1'), tx('tx2')]);
    renderSection();
    expect(screen.queryByRole('button', { name: /more transaction/i })).not.toBeInTheDocument();
  });

  // Selection/bulk is structurally unavailable on this surface (no bulk bar —
  // it would collide with the Money tab strip), so every card must be handed
  // the disabled set, including the long-press arming flag.
  it('hard-disables selection on every card', () => {
    seedQueue([tx('tx1'), tx('tx2'), tx('tx3')]);
    renderSection();

    expect(receivedCardProps).toHaveLength(3);
    for (const props of receivedCardProps) {
      expect(props.selectionMode).toBe(false);
      expect(props.isSelected).toBe(false);
      expect(props.enableLongPressSelect).toBe(false);
      expect(typeof props.onToggleSelect).toBe('function');
      expect(typeof props.onEnterSelectionMode).toBe('function');
    }

    // The no-op handlers are shared module-scope identities, so the card's memo
    // comparator isn't defeated by fresh arrow literals each render.
    const [first, second] = receivedCardProps;
    expect(first?.onToggleSelect).toBe(second?.onToggleSelect);
    expect(first?.onEnterSelectionMode).toBe(second?.onEnterSelectionMode);
  });

  it('hands its own pay-sheet callback to the triage hook', () => {
    seedQueue([tx('tx1')]);
    renderSection();
    expect(vi.mocked(useActionQueueTriage)).toHaveBeenCalledWith({ onOpenPaySheet });
  });
});
