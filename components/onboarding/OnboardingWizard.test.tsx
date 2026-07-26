import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OnboardingWizard from './OnboardingWizard';

/**
 * The onboarding wizard must only mark the "What I see" discovery flag seen
 * once the member has actually REACHED the visibility step (or later) —
 * otherwise a user who hits the persistent "Skip setup" link from an earlier
 * step (which renders on every step before 'done') never sees that step, the
 * flag still gets set, and the Dashboard's discovery card — the feature's
 * only other path to being found — never shows either.
 */

const {
  mockCompleteOnboarding,
  mockUpdateMember,
  mockAddAccount,
  mockAddHabit,
  mockDismissVisibilityDiscovery,
  mockNavigate,
} = vi.hoisted(() => ({
  mockCompleteOnboarding: vi.fn().mockResolvedValue(undefined),
  mockUpdateMember: vi.fn(),
  mockAddAccount: vi.fn().mockResolvedValue(undefined),
  mockAddHabit: vi.fn().mockResolvedValue(undefined),
  mockDismissVisibilityDiscovery: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ addAccount: mockAddAccount }),
  useGamification: () => ({ addHabit: mockAddHabit }),
  useHouseholdCore: () => ({
    householdSettings: { name: 'Test Household', inviteCode: 'ABC123', onboardingComplete: false },
    completeOnboarding: mockCompleteOnboarding,
    currentUser: { uid: 'user-1', displayName: 'Test User', role: 'admin', points: { daily: 0, weekly: 0, total: 0 } },
    updateMember: mockUpdateMember,
  }),
}));

vi.mock('@/utils/visibilityDiscovery', () => ({
  dismissVisibilityDiscovery: mockDismissVisibilityDiscovery,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Not under test here — stub out so the wizard's own step logic is what's exercised.
vi.mock('@/components/settings/MyViewSettings', () => ({
  MyViewSettings: () => <div data-testid="my-view-settings" />,
}));
vi.mock('@/components/auth/HouseholdInviteCard', () => ({
  default: () => <div data-testid="household-invite-card" />,
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const renderWizard = () =>
  render(
    <MemoryRouter>
      <OnboardingWizard />
    </MemoryRouter>
  );

describe('OnboardingWizard — visibility-discovery dismissal gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompleteOnboarding.mockResolvedValue(undefined);
    mockAddAccount.mockResolvedValue(undefined);
    mockAddHabit.mockResolvedValue(undefined);
    if (!('requestAnimationFrame' in window) || typeof window.requestAnimationFrame !== 'function') {
      vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    }
  });

  it('leaves the discovery flag UNSET when skipping from the very first step', async () => {
    renderWizard();

    expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));

    await vi.waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalled());
    expect(mockDismissVisibilityDiscovery).not.toHaveBeenCalled();
  });

  it('leaves the discovery flag UNSET when skipping before reaching the visibility step', async () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'Starting balance' })).toBeInTheDocument();

    // Skip from 'balance' — still before 'visibility'.
    fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));

    await vi.waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalled());
    expect(mockDismissVisibilityDiscovery).not.toHaveBeenCalled();
  });

  it('sets the discovery flag when skipping FROM the visibility step', async () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // balance -> habits
    fireEvent.click(screen.getByRole('button', { name: /skip for now|& continue/i })); // habits -> visibility

    expect(screen.getByRole('heading', { name: 'What I see' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skip setup' }));

    await vi.waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalled());
    expect(mockDismissVisibilityDiscovery).toHaveBeenCalledWith('user-1');
  });

  it('sets the discovery flag when completing the wizard all the way to done', async () => {
    renderWizard();

    fireEvent.click(screen.getByRole('button', { name: 'Get started' })); // welcome -> balance
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // balance -> habits
    fireEvent.click(screen.getByRole('button', { name: /skip for now|& continue/i })); // habits -> visibility
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // visibility -> invite
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // invite -> done

    expect(screen.getByRole('heading', { name: 'All set!' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go to dashboard' }));

    await vi.waitFor(() => expect(mockCompleteOnboarding).toHaveBeenCalled());
    expect(mockDismissVisibilityDiscovery).toHaveBeenCalledWith('user-1');
  });
});
