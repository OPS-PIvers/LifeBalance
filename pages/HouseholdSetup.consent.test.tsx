import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HouseholdSetup from './HouseholdSetup';
import { useAuth } from '@/contexts/AuthContext';
import { createHousehold, joinHousehold } from '@/services/householdService';

// HouseholdSetup depends on AuthContext, react-router-dom navigation, and the
// household service. Mock all three so we can render the page in isolation and
// focus on the Plan 011 consent gate.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  // No ?invite= param, so the page opens on the "choice" view.
  useSearchParams: () => [new URLSearchParams(''), vi.fn()],
}));

vi.mock('@/services/householdService', () => ({
  createHousehold: vi.fn(),
  joinHousehold: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('HouseholdSetup — consent gate (Plan 011)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Authenticated user with no household yet — i.e. a brand-new signup that
    // legitimately lands on /setup.
    vi.mocked(useAuth).mockReturnValue({
      user: { uid: 'user-1', displayName: 'Test', email: 't@example.com', photoURL: '' },
      currentUser: null,
      householdId: null,
      loading: false,
      signOut: vi.fn(),
      logout: vi.fn(),
      setHouseholdId: vi.fn(),
      accessDeniedEmail: null,
      clearAccessError: vi.fn(),
    } as unknown as ReturnType<typeof useAuth>);
  });

  it('keeps the Create button disabled until consent is checked', async () => {
    render(<HouseholdSetup />);
    fireEvent.click(screen.getByText('Create new household'));

    // Fill a valid household name so only consent gates the button.
    fireEvent.change(screen.getByPlaceholderText('e.g., Smith Family'), {
      target: { value: 'Smith Family' },
    });

    const submit = screen.getByRole('button', { name: /Create household/i });
    expect(submit).toBeDisabled();

    // Checking consent enables it.
    fireEvent.click(screen.getByLabelText(/I agree to the/i));
    expect(submit).toBeEnabled();
  });

  it('does not call createHousehold while consent is unchecked', async () => {
    render(<HouseholdSetup />);
    fireEvent.click(screen.getByText('Create new household'));

    fireEvent.change(screen.getByPlaceholderText('e.g., Smith Family'), {
      target: { value: 'Smith Family' },
    });

    // Submit the form directly (bypassing the disabled button) to prove the
    // handler guard also blocks the service call.
    fireEvent.submit(screen.getByRole('button', { name: /Create household/i }).closest('form')!);
    await waitFor(() => expect(createHousehold).not.toHaveBeenCalled());

    // With consent checked, the handler proceeds.
    vi.mocked(createHousehold).mockResolvedValue('hh-1');
    fireEvent.click(screen.getByLabelText(/I agree to the/i));
    fireEvent.click(screen.getByRole('button', { name: /Create household/i }));
    await waitFor(() => expect(createHousehold).toHaveBeenCalledWith('user-1', 'Smith Family'));
  });

  it('keeps the Join button disabled until consent is checked', async () => {
    render(<HouseholdSetup />);
    fireEvent.click(screen.getByText('Join existing household'));

    // Enter a full 6-char invite code so only consent gates the button.
    fireEvent.change(screen.getByPlaceholderText('ABC123'), {
      target: { value: 'ABC123' },
    });

    const submit = screen.getByRole('button', { name: /Join household/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/I agree to the/i));
    expect(submit).toBeEnabled();
  });

  it('does not call joinHousehold while consent is unchecked', async () => {
    render(<HouseholdSetup />);
    fireEvent.click(screen.getByText('Join existing household'));

    fireEvent.change(screen.getByPlaceholderText('ABC123'), {
      target: { value: 'ABC123' },
    });

    fireEvent.submit(screen.getByRole('button', { name: /Join household/i }).closest('form')!);
    await waitFor(() => expect(joinHousehold).not.toHaveBeenCalled());

    vi.mocked(joinHousehold).mockResolvedValue('hh-1');
    fireEvent.click(screen.getByLabelText(/I agree to the/i));
    fireEvent.click(screen.getByRole('button', { name: /Join household/i }));
    await waitFor(() => expect(joinHousehold).toHaveBeenCalledWith('user-1', 'ABC123'));
  });
});
