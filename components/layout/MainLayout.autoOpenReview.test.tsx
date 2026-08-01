import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Drawer } from '@/components/ui/Drawer';
import { resetOpenDrawersForTest } from '@/utils/openDrawerRegistry';
import { APP_REOPEN_MIN_HIDDEN_MS } from '@/hooks/useAppReopen';
import MainLayout from './MainLayout';
import type { ReviewQueueItem } from '@/utils/reviewQueue';

// The combined review queue MainLayout's auto-open latch watches. Mutable so a
// test can take it 0 → >0 the way a late Firestore delivery does. The context
// mocks below hand back fresh objects each render, so the `reviewQueueItems`
// memo recomputes and picks the new value up.
let queueItems: ReviewQueueItem[] = [];

vi.mock('./TopToolbar', () => ({ default: () => <div data-testid="top-toolbar" /> }));
vi.mock('./BottomNav', () => ({ default: () => <div data-testid="bottom-nav" /> }));
vi.mock('@/components/ui/InstallPwaBanner', () => ({ InstallPwaBanner: () => null }));
vi.mock('@/components/habits/HabitLocationPromptBanner', () => ({ default: () => null }));
vi.mock('@/components/habits/HabitLogIntent', () => ({ default: () => null }));
vi.mock('@/utils/preloadOnIdle', () => ({ preloadOnIdle: () => () => {} }));
vi.mock('@/hooks/useAppBadge', () => ({ useAppBadge: () => {} }));
vi.mock('@/hooks/useKidModeEnabled', () => ({ useKidModeEnabled: () => false }));
vi.mock('@/hooks/useKeyboardViewportAnchor', () => ({
  useKeyboardViewportAnchor: () => ({ shellRef: { current: null }, isKeyboardAnchored: false }),
}));
vi.mock('@/hooks/useNotificationActionIntent', () => ({
  useNotificationActionIntent: () => ({ logHabitId: null, clearLogHabit: () => {} }),
}));
vi.mock('@/utils/payPeriodCeremony', () => ({ subscribePayPeriodCeremony: () => () => {} }));
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: () => ({ isPlanTabVisible: () => true }),
}));
vi.mock('@/hooks/useActionQueue', () => ({
  useActionQueue: () => ({ actionQueue: [] }),
  needsReview: () => false,
  isReviewSnoozed: () => false,
}));
vi.mock('@/utils/reviewQueue', () => ({ buildReviewQueueSnapshot: () => queueItems }));
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    members: [],
    activeMemberId: null,
    isLoading: false,
    householdId: 'h1',
    householdSettings: {},
  }),
  useFinance: () => ({ transactions: [], buckets: [] }),
  useShopping: () => ({ shoppingAwaitingReview: [] }),
  useTodos: () => ({ todosAwaitingReview: [] }),
}));

// Stand-in for the real cycler: a real Drawer (so it registers on the shared
// open-drawer stack exactly as the real one does) carrying the same
// "Review (N of M)" title the shell drawer shows.
vi.mock('@/components/modals/ReviewPendingDrawer', () => ({
  default: ({ items, isOpen, onClose }: { items: ReviewQueueItem[]; isOpen: boolean; onClose: () => void }) => (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Review (1 of ${items.length})`}>
      <p>shell review cycler</p>
    </Drawer>
  ),
}));

const SHELL = 'Review (1 of 1)';
const ROW = 'Review Transaction';

const txItem = (id: string): ReviewQueueItem => ({
  kind: 'transaction',
  id,
  transaction: {
    id,
    amount: 88.4,
    merchant: 'ORONO WATER UTIL 4471',
    category: 'Utilities',
    date: '2026-08-01',
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
  },
});

/**
 * A page-level sheet the USER opened — the Action Queue row's "Review
 * Transaction" drawer, reduced to the part that matters here: a real Drawer on
 * the shared open-drawer stack.
 */
const RowDrawerPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open row review</button>
      <Drawer isOpen={open} onClose={() => setOpen(false)} title={ROW}>
        <p>row review form</p>
      </Drawer>
    </>
  );
};

/** Titles of the drawers currently in the DOM, in mount order. */
const dialogTitles = () =>
  screen.queryAllByRole('dialog').map((d) => d.querySelector('h3')?.textContent ?? '');

/** Closes a specific drawer by title — several can be on screen mid-animation. */
const closeDrawer = (title: string) => {
  const dialog = screen.queryAllByRole('dialog').find((d) => d.querySelector('h3')?.textContent === title);
  if (!dialog) throw new Error(`No drawer titled "${title}" is open (open: ${dialogTitles().join(', ') || 'none'})`);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close drawer' }));
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  fireEvent(document, new Event('visibilitychange'));
};

/** Drives the hidden → visible transition `useAppReopen` re-arms the latch on. */
const reopenAppAfterAbsence = () => {
  const base = Date.now();
  const nowSpy = vi.spyOn(Date, 'now');
  nowSpy.mockReturnValue(base);
  setVisibility('hidden');
  nowSpy.mockReturnValue(base + APP_REOPEN_MIN_HIDDEN_MS + 1000);
  setVisibility('visible');
  nowSpy.mockRestore();
};

const renderShell = () =>
  render(
    <MemoryRouter>
      <MainLayout>
        <RowDrawerPage />
      </MainLayout>
    </MemoryRouter>,
  );

describe('MainLayout — the auto-opened review drawer never stacks on another sheet', () => {
  beforeEach(() => {
    resetOpenDrawersForTest();
    queueItems = [];
  });

  afterEach(() => {
    setVisibility('visible');
  });

  it('holds a re-armed auto-open while a row review sheet is open, then delivers it on close', async () => {
    queueItems = [txItem('t1')];
    renderShell();

    // 1. App-open latch fires: the shell cycler auto-opens.
    await waitFor(() => expect(dialogTitles()).toContain(SHELL));

    // 2. User dismisses it and opens a row's own review sheet instead.
    closeDrawer(SHELL);
    await waitFor(() => expect(dialogTitles()).not.toContain(SHELL));
    fireEvent.click(screen.getByRole('button', { name: 'Open row review' }));
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    // 3. Phone backgrounded past the re-open threshold and brought back — the
    //    latch re-arms while the row sheet is still open and mid-edit.
    //    WITHOUT THE FIX the cycler force-opens on top of it, leaving two live
    //    review forms bound to the same transaction.
    reopenAppAfterAbsence();
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    // 4. Deferred, not dropped: closing the row sheet lets the auto-open land.
    //    (`toEqual` once the row sheet has finished animating out — it lingers
    //    in the DOM through its exit transition with isOpen already false.)
    closeDrawer(ROW);
    await waitFor(() => expect(dialogTitles()).toEqual([SHELL]));
  });

  it('holds an auto-open armed with no backgrounding at all, when a row sheet opened first', async () => {
    renderShell();
    await waitFor(() => expect(screen.getByTestId('top-toolbar')).toBeInTheDocument());
    expect(dialogTitles()).toHaveLength(0);

    // A pending transaction syncs in — the queue goes 0 → >0 with no gesture
    // and no app re-open, which is all the latch has ever needed to fire.
    queueItems = [txItem('t1')];

    fireEvent.click(screen.getByRole('button', { name: 'Open row review' }));
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    closeDrawer(ROW);
    await waitFor(() => expect(dialogTitles()).toContain(SHELL));
  });

  it('drops a held auto-open whose queue emptied while it waited', async () => {
    renderShell();
    queueItems = [txItem('t1')];

    fireEvent.click(screen.getByRole('button', { name: 'Open row review' }));
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    // The user resolves it in the sheet they were already in, so by the time
    // the held open gets its turn there is nothing left to review — it must
    // not open on a stale snapshot.
    queueItems = [];
    closeDrawer(ROW);

    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
  });
});
