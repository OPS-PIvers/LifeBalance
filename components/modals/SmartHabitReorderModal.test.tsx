import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SmartHabitReorderModal from './SmartHabitReorderModal';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { reorganizeHabits } from '@/services/geminiService';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

vi.mock('@/services/geminiService', () => ({
  reorganizeHabits: vi.fn(),
}));

// Mock Modal to avoid Portal issues and simplify testing
vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ isOpen, children, onClose }: { isOpen: boolean; children: React.ReactNode; onClose: () => void }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="modal-content">
        <button onClick={onClose} aria-label="Close">X</button>
        {children}
      </div>
    );
  },
}));

describe('SmartHabitReorderModal', () => {
  const mockHabits = [
    { id: '1', title: 'Habit 1', category: 'Morning', order: 1 },
    { id: '2', title: 'Habit 2', category: 'Evening', order: 2 },
  ];

  const mockReorderHabits = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useGamification as unknown as Mock).mockReturnValue({
      habits: mockHabits,
      reorderHabits: mockReorderHabits,
    });
    (useHouseholdCore as unknown as Mock).mockReturnValue({
      householdId: 'house-123',
    });
  });

  it('renders nothing when closed', () => {
    render(<SmartHabitReorderModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('modal-content')).not.toBeInTheDocument();
  });

  it('starts loading and analyzing when opened', async () => {
    // Return a promise that doesn't resolve immediately to test loading state
    (reorganizeHabits as unknown as Mock).mockReturnValue(new Promise(() => {}));

    render(<SmartHabitReorderModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Analyzing your routine...')).toBeInTheDocument();
    expect(screen.getByText('Gemini is finding the best flow for your day.')).toBeInTheDocument();
    // reorganizeHabits is now loaded via dynamic import(), so the call happens
    // after the import promise resolves rather than synchronously on mount.
    await waitFor(() => {
      expect(reorganizeHabits).toHaveBeenCalledWith('house-123', mockHabits);
    });
  });

  it('displays the plan when analysis succeeds', async () => {
    const mockPlan = {
      habits: [
        { id: '2', category: 'Morning', order: 1 }, // Moved Habit 2 to Morning
        { id: '1', category: 'Morning', order: 2 },
      ],
      reasoning: 'Moved Habit 2 to morning for better flow.',
    };
    (reorganizeHabits as unknown as Mock).mockResolvedValue(mockPlan);

    render(<SmartHabitReorderModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('Analyzing your routine...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Proposed Plan')).toBeInTheDocument();
    expect(screen.getByText('Moved Habit 2 to morning for better flow.')).toBeInTheDocument();

    // Check if categories are rendered (Mock plan puts both in Morning)
    expect(screen.getAllByText('Morning').length).toBeGreaterThan(0);

    // Check for change indicator
    // Habit 2 changed from Evening to Morning
    expect(screen.getByText('Evening')).toBeInTheDocument(); // Strikethrough part
    // Morning is present (both as category header and as new value)
    expect(screen.getAllByText('Morning').length).toBeGreaterThan(0);
  });

  it('displays error when analysis fails', async () => {
    (reorganizeHabits as unknown as Mock).mockRejectedValue(new Error('AI Busy'));

    render(<SmartHabitReorderModal isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to generate plan: AI Busy')).toBeInTheDocument();
    });
  });

  it('applies the plan when Apply Changes is clicked', async () => {
    const mockPlan = {
      habits: [
        { id: '1', category: 'Morning', order: 1 },
      ],
      reasoning: 'Good plan',
    };
    (reorganizeHabits as unknown as Mock).mockResolvedValue(mockPlan);
    const mockOnClose = vi.fn();

    render(<SmartHabitReorderModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Apply Changes')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Apply Changes'));

    await waitFor(() => {
      expect(mockReorderHabits).toHaveBeenCalledWith(mockPlan.habits);
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
