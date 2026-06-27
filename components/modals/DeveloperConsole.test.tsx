import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DeveloperConsole from './DeveloperConsole';
import { readAppConfigFlags, setAppFlag, AI_ENABLED_FLAG_KEY } from '@/services/appConfig';
import { resetAiEnabledCache } from '@/services/geminiService';

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

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  doc: vi.fn(),
  deleteDoc: vi.fn(),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
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
});
