import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Drawer } from '@/components/ui/Drawer';
import { resetOpenDrawersForTest } from '@/utils/openDrawerRegistry';
import { APP_REOPEN_MIN_HIDDEN_MS } from '@/hooks/useAppReopen';
import MainLayout from './MainLayout';
import type { ReviewQueueItem } from '@/utils/reviewQueue';
import type { HouseholdMember } from '@/types/schema';

// The combined review queue MainLayout's auto-open latch watches. Mutable so a
// test can take it 0 → >0 the way a late Firestore delivery does. The context
// mocks below hand back fresh objects each render, so the `reviewQueueItems`
// memo recomputes and picks the new value up.
let queueItems: ReviewQueueItem[] = [];

// The three inputs `activeKid` is derived from, mutable for the same reason:
// arming and landing the auto-open are separate renders, so a test has to be
// able to switch into (and back out of) Kid Mode BETWEEN them.
let kidModeEnabled = false;
let members: HouseholdMember[] = [];
let activeMemberId: string | null = null;

vi.mock('./TopToolbar', () => ({ default: () => <div data-testid="top-toolbar" /> }));
vi.mock('./BottomNav', () => ({ default: () => <div data-testid="bottom-nav" /> }));
vi.mock('@/components/ui/InstallPwaBanner', () => ({ InstallPwaBanner: () => null }));
vi.mock('@/components/habits/HabitLocationPromptBanner', () => ({ default: () => null }));
vi.mock('@/components/habits/HabitLogIntent', () => ({ default: () => null }));
vi.mock('@/utils/preloadOnIdle', () => ({ preloadOnIdle: () => () => {} }));
vi.mock('@/hooks/useAppBadge', () => ({ useAppBadge: () => {} }));
vi.mock('@/hooks/useKidModeEnabled', () => ({ useKidModeEnabled: () => kidModeEnabled }));
// The kid surface MainLayout early-returns INSTEAD of the whole parent shell.
vi.mock('@/components/kid/KidDashboard', () => ({
  default: () => <div data-testid="kid-dashboard" />,
}));
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
    members,
    activeMemberId,
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

/**
 * The shell cycler's title carries the size of the snapshot it opened with, so
 * it doubles as a read-out of WHEN the queue was snapshotted.
 */
const shellTitleFor = (queueSize: number) => `Review (1 of ${queueSize})`;

const member = (uid: string, extra: Partial<HouseholdMember> = {}): HouseholdMember => ({
  uid,
  displayName: uid,
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  ...extra,
});

const ADULT = member('adult-1');
const KID = member('kid_abc', { role: 'member', isManaged: true, managedByUid: 'adult-1' });

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

// A FRESH element each call — `rerender` with a referentially identical element
// is a no-op (React bails out), which would silently skip the render the mutated
// Kid-Mode mocks are meant to drive.
const shellTree = () => (
  <MemoryRouter>
    <MainLayout>
      <RowDrawerPage />
    </MainLayout>
  </MemoryRouter>
);

const renderShell = () => render(shellTree());

describe('MainLayout — the auto-opened review drawer never stacks on another sheet', () => {
  beforeEach(() => {
    resetOpenDrawersForTest();
    queueItems = [];
    kidModeEnabled = false;
    members = [];
    activeMemberId = null;
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

  it('holds a pending auto-open across a Kid Mode round-trip instead of consuming it on the kid render', async () => {
    const { rerender } = renderShell();
    await waitFor(() => expect(screen.getByTestId('top-toolbar')).toBeInTheDocument());

    // Armed while the user is in a row sheet, so it is held rather than landed.
    queueItems = [txItem('t1')];
    fireEvent.click(screen.getByRole('button', { name: 'Open row review' }));
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    // A parent switches into a kid. This swaps the ENTIRE shell, which unmounts
    // the row sheet that was holding the auto-open back — so the open-drawer
    // count drops to 0 on the very render `activeKid` turns true. That is the
    // hazard render: without `!activeKid` on the landing block the open is
    // consumed by a tree that never mounts the review drawer at all.
    kidModeEnabled = true;
    members = [ADULT, KID];
    activeMemberId = KID.uid;
    rerender(shellTree());

    await waitFor(() => expect(screen.getByTestId('kid-dashboard')).toBeInTheDocument());
    expect(screen.queryByTestId('top-toolbar')).not.toBeInTheDocument();
    expect(dialogTitles()).toHaveLength(0);

    // A second item syncs in while the kid has the screen. It is the tell: the
    // landing block re-snapshots the queue when it FIRES, so the size baked
    // into the cycler's title says whether the open was held until now (2) or
    // silently consumed back on the kid render with a stale snapshot (1).
    queueItems = [txItem('t1'), txItem('t2')];

    // Back to the parent — held, not dropped, so it lands now.
    kidModeEnabled = false;
    members = [];
    activeMemberId = null;
    rerender(shellTree());

    await waitFor(() => expect(dialogTitles()).toEqual([shellTitleFor(2)]));
  });

  it('lands normally for an adult in a household that HAS Kid Mode turned on', async () => {
    // The guard keys on `activeKid`, not on the global flag or the presence of
    // a managed member — an adult in a kid-enabled household is untouched.
    kidModeEnabled = true;
    members = [ADULT, KID];
    activeMemberId = ADULT.uid;
    renderShell();
    await waitFor(() => expect(screen.getByTestId('top-toolbar')).toBeInTheDocument());

    queueItems = [txItem('t1')];
    fireEvent.click(screen.getByRole('button', { name: 'Open row review' }));
    await waitFor(() => expect(dialogTitles()).toEqual([ROW]));

    closeDrawer(ROW);
    await waitFor(() => expect(dialogTitles()).toContain(SHELL));
  });
});
