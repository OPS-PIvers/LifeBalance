import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import CaptureModal from './CaptureModal';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Mock dependencies
vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  }
}));

// Mock useHousehold
const mockUseHousehold = {
  addTransaction: vi.fn(),
  buckets: [] as unknown[],
  habits: [] as unknown[],
  transactions: [] as unknown[],
  addToDo: vi.fn(),
  members: [] as unknown[],
  currentUser: { uid: 'test-user' },
  addShoppingItem: vi.fn(),
  householdId: 'test-household',
  stores: [] as unknown[],
  accounts: [] as unknown[],
};

// Each slice hook returns the shared superset object; destructuring in the
// component picks the fields it needs from whichever slice it calls.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => mockUseHousehold,
  useGamification: () => mockUseHousehold,
  useHouseholdCore: () => mockUseHousehold,
  useTodos: () => mockUseHousehold,
  useShopping: () => mockUseHousehold,
}));

// Module visibility (Plan 090): mocked so each test can choose which capture
// modules are enabled. Defaults to all-on (full 3-tab layout = pre-090 behavior).
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` capture modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // To-Do/Shop capture require the Plan master AND the sub-tab to be on.
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
  });
};

// Mock child components to simplify testing
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ children, isOpen, header }: { children: React.ReactNode; isOpen: boolean; header: React.ReactNode }) => isOpen ? (
    <div data-testid="drawer">
      <div data-testid="drawer-header">{header}</div>
      {children}
    </div>
  ) : null,
}));

// Expose onScan so a test can trigger startCamera() (the camera path) the same
// way the real Scan-Receipt control does, without rendering the full menu.
vi.mock('./CaptureMenu', () => ({
  CaptureMenu: ({ onScan }: { onScan: () => void }) => (
    <div data-testid="capture-menu">
      <button data-testid="scan-receipt" onClick={onScan}>Scan Receipt</button>
    </div>
  ),
}));

vi.mock('./CaptureTransactionManual', () => ({
  CaptureTransactionManual: () => <div data-testid="capture-transaction-manual">Manual Entry</div>,
}));

vi.mock('./CaptureTodoTab', () => ({
  CaptureTodoTab: () => <div data-testid="capture-todo-tab">Todo Tab</div>,
}));

vi.mock('./CaptureShoppingTab', () => ({
  CaptureShoppingTab: () => <div data-testid="capture-shopping-tab">Shopping Tab</div>,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Wallet: () => <span data-testid="icon-wallet" />,
  CheckSquare: () => <span data-testid="icon-check-square" />,
  ShoppingBag: () => <span data-testid="icon-shopping-bag" />,
  X: () => <span data-testid="icon-x" />,
  Loader2: () => <span data-testid="icon-loader" />,
  Store: () => <span data-testid="icon-store" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
}));

describe('CaptureModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all capture modules enabled (pre-090 behavior). Plan is on so the
    // To-Do/Shop sub-tab destinations are reachable.
    setEnabledModules(['money', 'plan', 'todos', 'shopping']);
  });

  it('renders correctly when open', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByText('Add Transaction')).toBeInTheDocument(); // Default title
  });

  it('does not render when closed', () => {
    render(<CaptureModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('renders tab switcher', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Expense')).toBeInTheDocument();
    expect(screen.getByText('To-Do')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();
  });

  it('switches to To-Do tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Initial state: Transaction tab (CaptureMenu)
    expect(screen.getByTestId('capture-menu')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-todo-tab')).not.toBeInTheDocument();

    // Click To-Do tab
    fireEvent.click(screen.getByText('To-Do'));

    // Check header update
    expect(screen.getByText('New Task')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('switches to Shopping tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Click Shop tab
    fireEvent.click(screen.getByText('Shop'));

    // Check header update
    expect(screen.getByText('Add Item')).toBeInTheDocument();

    // Check content update
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
  });

  it('switches back to Expense tab', () => {
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Go to Shop first
    fireEvent.click(screen.getByText('Shop'));
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();

    // Go back to Expense
    fireEvent.click(screen.getByText('Expense'));
    expect(screen.getByTestId('capture-menu')).toBeInTheDocument();
    expect(screen.getByText('Add Transaction')).toBeInTheDocument();
  });

  // --- Plan 090: capture-tab cascade ---

  it('only renders tabs whose module is enabled', () => {
    setEnabledModules(['plan', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    expect(screen.getByText('To-Do')).toBeInTheDocument();
    expect(screen.getByText('Shop')).toBeInTheDocument();
  });

  it('gates To-Do/Shop tabs behind the Plan master (only Expense when Plan is off)', () => {
    // todos + shopping flags on, but Plan off → their destinations are hidden,
    // so only the Expense (money) capture tab remains.
    setEnabledModules(['money', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    expect(screen.getByText('Add Transaction')).toBeInTheDocument(); // Expense active
    expect(screen.queryByText('To-Do')).not.toBeInTheDocument();
    expect(screen.queryByText('Shop')).not.toBeInTheDocument();
  });

  it('defaults the active tab to the first enabled tab when the default (money) is off', () => {
    // Money disabled, so the Expense (transaction) default is unavailable.
    setEnabledModules(['plan', 'todos', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // First enabled tab is To-Do — its content + title should be active.
    expect(screen.getByText('New Task')).toBeInTheDocument();
    expect(screen.getByTestId('capture-todo-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  it('hides the tab switcher when only one capture module is enabled', () => {
    setEnabledModules(['plan', 'shopping']);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // Single enabled tab renders its content with no switchable strip.
    expect(screen.getByTestId('capture-shopping-tab')).toBeInTheDocument();
    expect(screen.getByText('Add Item')).toBeInTheDocument();
    expect(screen.queryByText('Expense')).not.toBeInTheDocument();
    expect(screen.queryByText('To-Do')).not.toBeInTheDocument();
    // Sole tab's own label is not rendered as a switcher option.
    expect(screen.queryByText('Shop')).not.toBeInTheDocument();
  });

  it('renders a graceful empty state when no capture module is enabled', () => {
    setEnabledModules([]);
    render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

    // No crash on tabOptions[0]; a guidance message is shown instead.
    expect(screen.getByText(/No capture types are enabled/i)).toBeInTheDocument();
    expect(screen.queryByTestId('capture-menu')).not.toBeInTheDocument();
  });

  // --- Camera MediaStream lifecycle (resource leak) ---

  describe('camera stream cleanup on unmount', () => {
    let originalMediaDevices: MediaDevices | undefined;

    // Capture the original UNCONDITIONALLY so restoration is always correct,
    // even for a test in this block that never installs the fake — otherwise a
    // stale-undefined `originalMediaDevices` could `delete navigator.mediaDevices`
    // globally and break other suites in the same process.
    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
    });

    afterEach(() => {
      // Restore whatever was (or wasn't) on navigator.mediaDevices.
      if (originalMediaDevices === undefined) {
        delete (navigator as { mediaDevices?: MediaDevices }).mediaDevices;
      } else {
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: originalMediaDevices,
        });
      }
    });

    /** Build two fake tracks each carrying a `stop` spy. */
    const makeTracks = () => [{ stop: vi.fn() }, { stop: vi.fn() }];

    /**
     * Install a fake getUserMedia that resolves a MediaStream whose tracks each
     * carry a `stop` spy, so we can assert the tracks were released.
     */
    const mockGetUserMedia = () => {
      const tracks = makeTracks();
      const fakeStream = {
        getTracks: () => tracks,
      } as unknown as MediaStream;
      const getUserMedia = vi.fn().mockResolvedValue(fakeStream);

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
      });

      return { tracks, getUserMedia };
    };

    /**
     * Install a fake getUserMedia whose promise we resolve manually, so a test
     * can unmount WHILE the call is still in flight (the async-unmount race).
     */
    const mockDeferredGetUserMedia = () => {
      const tracks = makeTracks();
      const fakeStream = {
        getTracks: () => tracks,
      } as unknown as MediaStream;
      let resolveStream!: () => void;
      const pending = new Promise<MediaStream>((resolve) => {
        resolveStream = () => resolve(fakeStream);
      });
      const getUserMedia = vi.fn().mockReturnValue(pending);

      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia },
      });

      return { tracks, getUserMedia, resolveStream };
    };

    it("stops every camera track when the component unmounts while the camera is open (doesn't go through handleClose)", async () => {
      const { tracks, getUserMedia } = mockGetUserMedia();

      const { unmount } = render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      // Open the camera via the Scan-Receipt control (drives startCamera()).
      fireEvent.click(screen.getByTestId('scan-receipt'));

      // Wait for the stream to be acquired and stored in state.
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

      // Tracks must still be live before unmount — proves we're testing the
      // unmount cleanup, not something the normal flow already stopped.
      expect(tracks[0]!.stop).not.toHaveBeenCalled();
      expect(tracks[1]!.stop).not.toHaveBeenCalled();

      // Unmount WITHOUT calling onClose/handleClose — mirrors ProtectedRoute
      // dropping MainLayout (and the LazyMount-ed CaptureModal) on sign-out.
      unmount();

      // The cleanup effect must have released every track.
      expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
      expect(tracks[1]!.stop).toHaveBeenCalledTimes(1);
      // It left for good, not via the close handler.
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('stops the stream acquired by a getUserMedia call that resolves AFTER the component unmounts (async-unmount race)', async () => {
      const { tracks, getUserMedia, resolveStream } = mockDeferredGetUserMedia();

      const { unmount } = render(<CaptureModal isOpen={true} onClose={mockOnClose} />);

      // Kick off startCamera(); getUserMedia is now in flight (unresolved).
      fireEvent.click(screen.getByTestId('scan-receipt'));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));

      // Unmount BEFORE the stream resolves. cameraStream is still null here, so
      // the cleanup effect is a no-op and will never run again.
      unmount();
      expect(tracks[0]!.stop).not.toHaveBeenCalled();

      // Now the camera finally becomes available — on an unmounted component.
      // The isMounted guard must stop the orphaned stream instead of leaking it.
      await act(async () => {
        resolveStream();
        // Flush the awaited continuation inside startCamera.
        await Promise.resolve();
      });

      expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
      expect(tracks[1]!.stop).toHaveBeenCalledTimes(1);
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });
});
