import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getDocs, writeBatch, type DocumentData, type QuerySnapshot } from 'firebase/firestore';
import DeveloperConsole from './DeveloperConsole';
import { readAppConfigFlags, setAppFlag, AI_ENABLED_FLAG_KEY } from '@/services/appConfig';
import { resetAiEnabledCache } from '@/services/geminiService';
import { appendActivityLog } from '@/utils/activityLog';
import type { Habit, Household, HouseholdMember } from '@/types/schema';

// Mock Modal component — render children when open so nested dialogs (ConfirmDialog,
// which is built on Modal) also render their controls during the test.
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean; onClose: () => void }) => {
    if (!isOpen) return null;
    return (
      <div role="dialog">
        {/* We do NOT add a close button here in the mock, to test if DeveloperConsole adds it */}
        {children}
      </div>
    );
  },
}));

// Mock Firebase
vi.mock('@/firebase.config', () => ({
  db: {},
}));

// writeBatch's return value is spied on directly by the points-drift-repair
// describe block below (update/set/commit); other tests never touch it.
const mockBatch = {
  update: vi.fn(),
  set: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
};

// `collection`/`doc` carry the Firestore path on a `__path` field (real refs
// aren't plain strings, but every test only needs to key off the path) so
// `getDocs`/`getDoc` mocks below can branch per-collection instead of every
// caller racing the same blanket resolved value. `query` is a pass-through —
// none of these tests need to inspect `limit`/`orderBy` constraints.
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, path: string) => ({ __path: path })),
  query: vi.fn((ref: unknown) => ref),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn((_db: unknown, path: string, id?: string) => ({
    __path: id ? `${path}/${id}` : path,
  })),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  arrayUnion: vi.fn(),
  arrayRemove: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => mockBatch),
}));

// DeveloperConsole reads the acting admin's identity for the points-drift
// repair activity-log entry. In production it always runs under the app's
// AuthProvider (Settings is a protected, authenticated route); tests must
// supply the same seam other admin-surface tests use (see FeedbackModal.test.tsx).
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'admin-uid', displayName: 'Admin' },
  }),
}));

// appendActivityLog writes a batch.set() call the points-drift tests don't
// assert on directly; stub it so it doesn't need a real Firestore converter.
vi.mock('@/utils/activityLog', () => ({
  appendActivityLog: vi.fn(),
}));

// Mock the app-config service so the Feature Flags tab reads/writes through a
// controllable seam (no real Firestore). setAppFlag is asserted directly.
vi.mock('@/services/appConfig', async () => {
  const actual = await vi.importActual<typeof import('@/services/appConfig')>('@/services/appConfig');
  return {
    ...actual,
    readAppConfigFlags: vi.fn(),
    setAppFlag: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock geminiService so flipping the AI flag can be asserted without pulling the SDK.
vi.mock('@/services/geminiService', () => ({
  resetAiEnabledCache: vi.fn(),
}));

// Mock toast
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Loader2: () => <div data-testid="icon-loader" />,
  Plus: () => <div data-testid="icon-plus" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Copy: () => <div data-testid="icon-copy" />,
  X: () => <div data-testid="icon-x" />,
  AlertTriangle: () => <div data-testid="icon-alert" />,
}));

const mockedReadFlags = vi.mocked(readAppConfigFlags);
const mockedSetFlag = vi.mocked(setAppFlag);
const mockedResetAiCache = vi.mocked(resetAiEnabledCache);

/** Default effective-flag state: the three gates off, AI fail-open ON. */
const DEFAULT_FLAGS: Record<string, boolean> = {
  openSignup: false,
  billingEnabled: false,
  kidModeEnabled: false,
  plaidEnabled: false,
  [AI_ENABLED_FLAG_KEY]: true,
};

describe('DeveloperConsole', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedReadFlags.mockResolvedValue({ ...DEFAULT_FLAGS });
  });

  it('renders correctly when open', async () => {
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Developer Console')).toBeInTheDocument();

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });
  });

  it('renders a close button', async () => {
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    // Wait for loading to finish
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);

    // Wait for loading to finish first
    await waitFor(() => {
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);

    expect(mockOnClose).toHaveBeenCalled();
  });

  describe('Feature Flags tab', () => {
    /** Render, switch to the Feature Flags tab, and wait for the flags to load. */
    const openFlagsTab = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
      await user.click(screen.getByRole('tab', { name: 'Feature Flags' }));
      await waitFor(() => {
        expect(mockedReadFlags).toHaveBeenCalled();
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
      });
    };

    it('renders all five flags with their effective ON/OFF state', async () => {
      const user = userEvent.setup();
      await openFlagsTab(user);

      // All five flag labels render.
      const kidRow = screen.getByText('Kid Mode').closest('div')!;
      const billingRow = screen.getByText('Billing / Freemium').closest('div')!;
      const signupRow = screen.getByText('Open Signup').closest('div')!;
      const plaidRow = screen.getByText('Plaid Bank Link').closest('div')!;
      const aiRow = screen.getByText('AI Enabled').closest('div')!;

      // Four gates default OFF (incl. Plaid)...
      expect(within(kidRow).getByText('OFF')).toBeInTheDocument();
      expect(within(billingRow).getByText('OFF')).toBeInTheDocument();
      expect(within(signupRow).getByText('OFF')).toBeInTheDocument();
      expect(within(plaidRow).getByText('OFF')).toBeInTheDocument();
      // ...and the AI master switch is fail-open ON by default.
      expect(within(aiRow).getByText('ON')).toBeInTheDocument();
    });

    it('confirm-gates the Plaid flag flip and writes plaidEnabled (no AI cache reset)', async () => {
      const user = userEvent.setup();
      await openFlagsTab(user);

      const plaidToggle = screen.getByRole('checkbox', { name: /Turn Plaid Bank Link ON/i });
      await user.click(plaidToggle);
      expect(mockedSetFlag).not.toHaveBeenCalled();
      const confirmBtn = await screen.findByRole('button', { name: /Turn ON/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockedSetFlag).toHaveBeenCalledWith('plaidEnabled', true);
      });
      expect(mockedResetAiCache).not.toHaveBeenCalled();
    });

    it('shows aiEnabled as ON when the field is absent (fail-open default)', async () => {
      // readAppConfigFlags is responsible for the fail-open default; assert the UI
      // surfaces ON when it returns aiEnabled: true for an absent field.
      mockedReadFlags.mockResolvedValue({
        openSignup: false,
        billingEnabled: false,
        kidModeEnabled: false,
        [AI_ENABLED_FLAG_KEY]: true,
      });
      const user = userEvent.setup();
      await openFlagsTab(user);

      const aiToggle = screen.getByRole('checkbox', { name: /Turn AI Enabled OFF/i });
      expect(aiToggle).toBeChecked();
    });

    it('confirm-gates a flip and calls setAppFlag with the right key/value on confirm', async () => {
      const user = userEvent.setup();
      await openFlagsTab(user);

      // Kid Mode is OFF → its switch prompts to turn ON.
      const kidToggle = screen.getByRole('checkbox', { name: /Turn Kid Mode ON/i });
      await user.click(kidToggle);

      // A confirm dialog appears; nothing is written yet.
      expect(mockedSetFlag).not.toHaveBeenCalled();
      const confirmBtn = await screen.findByRole('button', { name: /Turn ON/i });

      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockedSetFlag).toHaveBeenCalledWith('kidModeEnabled', true);
      });
      // Non-AI flag: the gemini cache reset is NOT called.
      expect(mockedResetAiCache).not.toHaveBeenCalled();
      // Flags are re-read from source of truth after the write.
      expect(mockedReadFlags).toHaveBeenCalledTimes(2);
    });

    it('flipping the AI master switch OFF also resets the gemini cache', async () => {
      const user = userEvent.setup();
      await openFlagsTab(user);

      // AI is ON → its switch prompts to turn OFF.
      const aiToggle = screen.getByRole('checkbox', { name: /Turn AI Enabled OFF/i });
      await user.click(aiToggle);

      const confirmBtn = await screen.findByRole('button', { name: /Turn OFF/i });
      await user.click(confirmBtn);

      await waitFor(() => {
        expect(mockedSetFlag).toHaveBeenCalledWith(AI_ENABLED_FLAG_KEY, false);
      });
      expect(mockedResetAiCache).toHaveBeenCalledTimes(1);
    });

    it('does not write when the confirm dialog is cancelled', async () => {
      const user = userEvent.setup();
      await openFlagsTab(user);

      const billingToggle = screen.getByRole('checkbox', { name: /Turn Billing \/ Freemium ON/i });
      await user.click(billingToggle);

      const cancelBtn = await screen.findByRole('button', { name: /Cancel/i });
      await user.click(cancelBtn);

      expect(mockedSetFlag).not.toHaveBeenCalled();
    });
  });

  describe('Points drift repair (Feature Flags tab)', () => {
    const mockedGetDocs = vi.mocked(getDocs);
    const mockedWriteBatch = vi.mocked(writeBatch);
    const mockedAppendActivityLog = vi.mocked(appendActivityLog);

    const PAUL = 'paul-uid';
    const JEN = 'jen-uid';

    const fakeDoc = <T,>(id: string, data: T) => ({ id, data: () => data });

    // getDocs's real return type is the full Firestore `QuerySnapshot`
    // (metadata, query, size, forEach, docChanges, ...) — these fixtures only
    // ever read `.docs[].id` / `.data()` (all `runPointsDriftScan` touches),
    // so this single, explicit, narrowly-scoped assertion stands in for a
    // real snapshot rather than hand-implementing the rest of the interface.
    const asSnapshot = (docs: { id: string; data: () => unknown }[]) =>
      ({ docs }) as unknown as QuerySnapshot<unknown, DocumentData>;

    const habit = (overrides: Partial<Habit> = {}): Habit => ({
      id: 'h1',
      title: 'Exercise',
      category: 'Health',
      type: 'positive',
      period: 'daily',
      scoringType: 'incremental',
      basePoints: 10,
      targetCount: 1,
      count: 0,
      totalCount: 0,
      completedDates: [],
      streakDays: 0,
      lastUpdated: '2024-06-01T12:00:00.000Z',
      ...overrides,
    });

    const householdData = (overrides: Partial<Household> = {}): Household =>
      ({
        name: 'House',
        inviteCode: 'ABC123',
        members: [],
        accounts: [],
        rewardsInventory: [],
        coreTemplates: { expenses: [], buckets: [] },
        freezeBank: { current: 0, accrued: 0, lastMonth: '' },
        ...overrides,
      }) as Household;

    const memberData = (uid: string, overrides: Partial<HouseholdMember> = {}): HouseholdMember => ({
      uid,
      displayName: uid,
      role: 'admin',
      points: { daily: 0, weekly: 0, total: 0 },
      ...overrides,
    });

    /**
     * Wires the path-aware `getDocs` mock for a two-household fixture:
     *  - "house-a" has a shared habit both PAUL and JEN completed on the same
     *    day. The household pool banked both awards (correct); JEN's own
     *    `points.total` was never written — the exact cross-member drop this
     *    tool exists to repair. One determinable write comes out of this
     *    household (JEN: 0 → 10).
     *  - "house-b" has NO attribution data at all (pre-attribution history
     *    only) — every row must come back `cannot_determine`, producing NO
     *    write, proving a household with nothing determinable never reaches
     *    Phase 2 and is never batched.
     */
    const wireTwoHouseholdFixture = () => {
      const sharedHabit = habit({
        completedDates: ['2024-06-01'],
        count: 1,
        completedBy: { '2024-06-01': { [PAUL]: 1, [JEN]: 1 } },
      });
      const legacyHabit = habit({
        id: 'h2',
        completedDates: ['2024-06-01'],
        count: 1,
        scoringType: 'threshold',
        // No completedBy at all — pre-attribution history.
      });

      mockedGetDocs.mockImplementation(async (ref: unknown) => {
        const path = (ref as { __path?: string } | undefined)?.__path ?? '';
        if (path === 'households') {
          return asSnapshot([
            fakeDoc('house-a', householdData({ points: { daily: 0, weekly: 0, total: 20 } })),
            fakeDoc('house-b', householdData({ points: { daily: 0, weekly: 0, total: 10 } })),
          ]);
        }
        if (path === 'households/house-a/members') {
          return asSnapshot([
            fakeDoc(PAUL, memberData(PAUL, { points: { daily: 0, weekly: 0, total: 10 } })),
            fakeDoc(JEN, memberData(JEN, { points: { daily: 0, weekly: 0, total: 0 } })),
          ]);
        }
        if (path === 'households/house-a/habits') {
          return asSnapshot([fakeDoc(sharedHabit.id, sharedHabit)]);
        }
        if (path === 'households/house-b/members') {
          return asSnapshot([fakeDoc(PAUL, memberData(PAUL, { points: { daily: 0, weekly: 0, total: 37 } }))]);
        }
        if (path === 'households/house-b/habits') {
          return asSnapshot([fakeDoc(legacyHabit.id, legacyHabit)]);
        }
        return asSnapshot([]);
      });
    };

    /** Render, switch to Feature Flags, wait for the drift-repair panel. */
    const openFlagsTabForDrift = async (user: ReturnType<typeof userEvent.setup>) => {
      render(<DeveloperConsole isOpen={true} onClose={mockOnClose} />);
      await user.click(screen.getByRole('tab', { name: 'Feature Flags' }));
      await waitFor(() => {
        expect(mockedReadFlags).toHaveBeenCalled();
        expect(screen.queryByTestId('icon-loader')).not.toBeInTheDocument();
      });
      return screen.getByRole('button', { name: /Scan for drift/i });
    };

    it('opening the console and the Feature Flags tab never scans or writes on its own', async () => {
      const user = userEvent.setup();
      wireTwoHouseholdFixture();
      await openFlagsTabForDrift(user);

      // The console's default tab ('Beta Testers') fires its own unrelated
      // getDocs('beta_testers') on mount — that's expected. What must NOT
      // happen merely from opening the console and switching to Feature
      // Flags is any read of the households/members/habits collections the
      // drift scan touches, and no write ever opens.
      const scannedPaths = mockedGetDocs.mock.calls.map(
        ([ref]) => (ref as { __path?: string } | undefined)?.__path
      );
      expect(scannedPaths).not.toContain('households');
      expect(scannedPaths.some(p => p?.includes('/members') || p?.includes('/habits'))).toBe(false);
      expect(mockedWriteBatch).not.toHaveBeenCalled();
    });

    it('Scan is read-only: it reports the determinable fix but writes nothing', async () => {
      const user = userEvent.setup();
      wireTwoHouseholdFixture();
      const scanButton = await openFlagsTabForDrift(user);

      await user.click(scanButton);

      await waitFor(() => {
        expect(screen.getByText(/under-credited by 10/i)).toBeInTheDocument();
      });
      // The proposed-fix summary and the confirm-phrase input both appear...
      expect(screen.getByText(/1 determinable fix\(es\) ready to apply/i)).toBeInTheDocument();
      const applyButton = screen.getByRole('button', { name: /^Apply fixes$/i });
      expect(applyButton).toBeDisabled();
      // ...but Scan itself performed zero writes.
      expect(mockedWriteBatch).not.toHaveBeenCalled();
      expect(mockBatch.update).not.toHaveBeenCalled();
      expect(mockBatch.commit).not.toHaveBeenCalled();
    });

    it('cannot_determine rows never surface an Apply control — a household with nothing determinable has no apply path', async () => {
      const user = userEvent.setup();
      // Only the pre-attribution household — nothing determinable anywhere.
      mockedGetDocs.mockImplementation(async (ref: unknown) => {
        const path = (ref as { __path?: string } | undefined)?.__path ?? '';
        const legacyHabit = habit({ completedDates: ['2024-06-01'], count: 1, scoringType: 'threshold' });
        if (path === 'households') {
          return asSnapshot([fakeDoc('house-b', householdData({ points: { daily: 0, weekly: 0, total: 10 } }))]);
        }
        if (path === 'households/house-b/members') {
          return asSnapshot([fakeDoc(PAUL, memberData(PAUL, { points: { daily: 0, weekly: 0, total: 37 } }))]);
        }
        if (path === 'households/house-b/habits') {
          return asSnapshot([fakeDoc(legacyHabit.id, legacyHabit)]);
        }
        return asSnapshot([]);
      });
      const scanButton = await openFlagsTabForDrift(user);
      await user.click(scanButton);

      // The static help text above the button also contains the phrase
      // "cannot determine" — match the actual verdict line's specific reason
      // instead, so this only passes on the real report row.
      await waitFor(() => {
        expect(screen.getByText(/pre-attribution history cannot be split per member/i)).toBeInTheDocument();
      });
      expect(screen.queryByText(/determinable fix\(es\) ready to apply/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Apply fixes$/i })).not.toBeInTheDocument();
      expect(mockedWriteBatch).not.toHaveBeenCalled();
    });

    it('Apply stays disabled until the exact confirm phrase is typed, and a partial phrase writes nothing', async () => {
      const user = userEvent.setup();
      wireTwoHouseholdFixture();
      const scanButton = await openFlagsTabForDrift(user);
      await user.click(scanButton);
      await waitFor(() => expect(screen.getByText(/1 determinable fix\(es\) ready to apply/i)).toBeInTheDocument());

      const applyButton = screen.getByRole('button', { name: /^Apply fixes$/i });
      const confirmInput = screen.getByPlaceholderText('REPAIR POINTS');

      await user.type(confirmInput, 'REPAIR');
      expect(applyButton).toBeDisabled();

      // Clicking a disabled button is a no-op in userEvent; assert the guard
      // holds regardless by confirming no batch was ever opened.
      await user.click(applyButton);
      expect(mockedWriteBatch).not.toHaveBeenCalled();
    });

    it('Apply, once confirmed, batches every write for one household atomically and skips the household with nothing determinable', async () => {
      const user = userEvent.setup();
      wireTwoHouseholdFixture();
      const scanButton = await openFlagsTabForDrift(user);
      await user.click(scanButton);
      await waitFor(() => expect(screen.getByText(/1 determinable fix\(es\) ready to apply/i)).toBeInTheDocument());

      const confirmInput = screen.getByPlaceholderText('REPAIR POINTS');
      await user.type(confirmInput, 'REPAIR POINTS');
      const applyButton = screen.getByRole('button', { name: /^Apply fixes$/i });
      expect(applyButton).toBeEnabled();
      await user.click(applyButton);

      await waitFor(() => {
        expect(mockBatch.commit).toHaveBeenCalledTimes(1);
      });
      // Exactly ONE household ever opened a batch — house-b had nothing
      // determinable and must never be touched.
      expect(mockedWriteBatch).toHaveBeenCalledTimes(1);
      // The one determinable write (JEN's under-credit) lands in that single
      // batch as an absolute, already-floored total — never an increment.
      expect(mockBatch.update).toHaveBeenCalledTimes(1);
      expect(mockBatch.update).toHaveBeenCalledWith(
        { __path: 'households/house-a/members/jen-uid' },
        { 'points.total': 10 }
      );
      // Auditable: one activity-log entry for the household that was touched.
      expect(mockedAppendActivityLog).toHaveBeenCalledTimes(1);
      expect(mockedAppendActivityLog).toHaveBeenCalledWith(
        mockBatch,
        expect.anything(),
        'house-a',
        expect.objectContaining({ uid: 'admin-uid' }),
        expect.objectContaining({ domain: 'member', action: 'points_drift_repaired' })
      );
    });
  });
});
