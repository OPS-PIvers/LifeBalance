
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SmartHabitAdjustModal from './SmartHabitAdjustModal';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('@/services/geminiService', () => ({
  analyzeHabitPoints: vi.fn(),
}));

// Import mocked modules to set implementations
import { analyzeHabitPoints } from '@/services/geminiService';

describe('SmartHabitAdjustModal', () => {
  const mockOnClose = vi.fn();
  const mockUpdateHabit = vi.fn();
  const mockHabits = [
    { id: '1', title: 'Run', basePoints: 10 }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as any).mockReturnValue({
      habits: mockHabits,
      updateHabit: mockUpdateHabit,
    });
  });

  it('does not render when closed', () => {
    render(<SmartHabitAdjustModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Smart Adjustments')).not.toBeInTheDocument();
  });

  it('renders loading state initially', async () => {
    (analyzeHabitPoints as any).mockReturnValue(new Promise(() => {})); // Never resolves
    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByText('Analyzing your habits...')).toBeInTheDocument();
  });

  it('renders suggestions when loaded', async () => {
    const mockSuggestions = [
      {
        habitId: '1',
        habitTitle: 'Run',
        currentPoints: 10,
        suggestedPoints: 15,
        reasoning: 'Motivation boost',
      },
    ];
    (analyzeHabitPoints as any).mockResolvedValue(mockSuggestions);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Smart Adjustments')).toBeInTheDocument();
    });

    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('Motivation boost')).toBeInTheDocument();
    expect(screen.getByText('15 pts')).toBeInTheDocument();
  });

  it('renders empty state when no suggestions returned', async () => {
    (analyzeHabitPoints as any).mockResolvedValue([]);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('No adjustments needed!')).toBeInTheDocument();
    });
  });

  it('renders error state on failure', async () => {
    (analyzeHabitPoints as any).mockRejectedValue(new Error('API Error'));

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to generate suggestions. Please try again later.')).toBeInTheDocument();
    });
  });

  it('calls updateHabit when accepting suggestion', async () => {
    const mockSuggestions = [
      {
        habitId: '1',
        habitTitle: 'Run',
        currentPoints: 10,
        suggestedPoints: 15,
        reasoning: 'Motivation boost',
      },
    ];
    (analyzeHabitPoints as any).mockResolvedValue(mockSuggestions);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Accept Change'));

    await waitFor(() => {
      expect(mockUpdateHabit).toHaveBeenCalledWith({
        ...mockHabits[0],
        basePoints: 15,
      });
    });
  });

  it('removes suggestion when ignored', async () => {
    const mockSuggestions = [
      {
        habitId: '1',
        habitTitle: 'Run',
        currentPoints: 10,
        suggestedPoints: 15,
        reasoning: 'Motivation boost',
      },
    ];
    (analyzeHabitPoints as any).mockResolvedValue(mockSuggestions);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Ignore'));

    await waitFor(() => {
      expect(screen.queryByText('Run')).not.toBeInTheDocument();
    });
    expect(mockUpdateHabit).not.toHaveBeenCalled();
  });
});
