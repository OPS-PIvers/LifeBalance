import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import YearlyGoalFormModal from './YearlyGoalFormModal';
import { YearlyGoal } from '@/types/schema';

// Mock contexts
const mockCreateYearlyGoal = vi.fn();
const mockUpdateYearlyGoal = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: () => ({
    createYearlyGoal: mockCreateYearlyGoal,
    updateYearlyGoal: mockUpdateYearlyGoal,
  }),
}));

// Mock icons
vi.mock('lucide-react', async () => {
  return {
    X: () => <span data-testid="x-icon" />,
    Loader2: () => <span data-testid="loader-icon" />,
  };
});

describe('YearlyGoalFormModal', () => {
  it('renders correctly when open', () => {
    render(<YearlyGoalFormModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('New Yearly Goal')).toBeInTheDocument();

    // Check inputs are accessible by label
    expect(screen.getByLabelText(/Goal Title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Year$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Required Months/i)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<YearlyGoalFormModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByText('New Yearly Goal')).not.toBeInTheDocument();
  });

  it('calls onClose when Close (X) button is clicked', () => {
    const handleClose = vi.fn();
    render(<YearlyGoalFormModal isOpen={true} onClose={handleClose} />);

    const closeButton = screen.getByLabelText('Close drawer');
    fireEvent.click(closeButton);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('populates form when editingGoal is provided', async () => {
    const goal: YearlyGoal = {
      id: 'test-id',
      title: 'Existing Goal',
      description: 'Existing Description',
      year: 2025,
      requiredMonths: 8,
      successfulMonths: [],
      status: 'in_progress',
      createdBy: 'user',
      createdAt: 'date'
    };

    render(<YearlyGoalFormModal isOpen={true} onClose={() => {}} editingGoal={goal} />);

    // Wait for the useEffect timeout
    await waitFor(() => {
        expect(screen.getByDisplayValue('Existing Goal')).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Goal Title/i)).toHaveValue('Existing Goal');
    expect(screen.getByLabelText(/Description/i)).toHaveValue('Existing Description');
    expect(screen.getByLabelText(/^Year$/i)).toHaveValue(2025);
    expect(screen.getByLabelText(/Required Months/i)).toHaveValue(8);

    expect(screen.getByText('Edit Yearly Goal')).toBeInTheDocument();
  });

  it('only submits once when the save button is double-clicked mid-save', async () => {
    let resolveCreate: () => void = () => {};
    mockCreateYearlyGoal.mockImplementation(
      () => new Promise<void>(resolve => { resolveCreate = resolve; })
    );
    const handleClose = vi.fn();
    render(<YearlyGoalFormModal isOpen={true} onClose={handleClose} />);

    fireEvent.change(screen.getByLabelText(/Goal Title/i), { target: { value: 'My Goal' } });

    const saveButton = screen.getByRole('button', { name: /Create Goal/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(mockCreateYearlyGoal).toHaveBeenCalledTimes(1);

    // The drawer's Close button is inert while the save is in flight.
    fireEvent.click(screen.getByLabelText('Close drawer'));
    expect(handleClose).not.toHaveBeenCalled();

    resolveCreate();
    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1));
  });
});
