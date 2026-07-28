import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SavingsGoals from './SavingsGoals';
import { SavingsGoal, HouseholdMember } from '@/types/schema';

const {
  addSavingsGoalMock,
  updateSavingsGoalMock,
  deleteSavingsGoalMock,
  contributeToGoalMock,
} = vi.hoisted(() => ({
  addSavingsGoalMock: vi.fn(),
  updateSavingsGoalMock: vi.fn(),
  deleteSavingsGoalMock: vi.fn(),
  contributeToGoalMock: vi.fn(),
}));

const mockGoals: SavingsGoal[] = [
  {
    id: 'goal1',
    name: 'Christmas',
    targetAmount: 1200,
    savedAmount: 300,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'goal2',
    name: 'New Bike',
    targetAmount: 150,
    savedAmount: 150,
    completedAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const mockMembers: HouseholdMember[] = [
  { uid: 'parent1', displayName: 'Parent', role: 'admin', points: { daily: 0, weekly: 0, total: 0 } },
  { uid: 'kid_leo', displayName: 'Leo', role: 'kid', isManaged: true, points: { daily: 0, weekly: 0, total: 0 } },
];

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => ({
    savingsGoals: mockGoals,
    addSavingsGoal: addSavingsGoalMock,
    updateSavingsGoal: updateSavingsGoalMock,
    deleteSavingsGoal: deleteSavingsGoalMock,
    contributeToGoal: contributeToGoalMock,
    members: mockMembers,
  });
  return {
    useFinance: value,
    useHouseholdCore: value,
  };
});

vi.mock('lucide-react', () => ({
  PiggyBank: () => <span data-testid="piggy-bank-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Star: () => <span data-testid="star-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  MoreVertical: () => <span data-testid="more-vertical-icon" />,
  ChevronDown: () => <span data-testid="chevron-down-icon" />,
}));

vi.mock('@/components/ui/Drawer', () => {
  interface MockDrawerProps {
    children: React.ReactNode;
    isOpen: boolean;
    title?: string;
    onClose?: () => void;
    footer?: React.ReactNode;
  }
  return {
    Drawer: ({ children, isOpen, title, footer }: MockDrawerProps) => {
      if (!isOpen) return null;
      return (
        <div data-testid="drawer">
          <h3>{title}</h3>
          {children}
          {footer && <div data-testid="drawer-footer">{footer}</div>}
        </div>
      );
    },
  };
});

describe('SavingsGoals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders each goal with its progress toward target', () => {
    render(<SavingsGoals />);
    expect(screen.getByText('Christmas')).toBeInTheDocument();
    expect(screen.getByText('New Bike')).toBeInTheDocument();
    // 300 / 1200 = 25%
    expect(screen.getByText('25% saved')).toBeInTheDocument();
  });

  it('opens the create drawer and submits a new goal', () => {
    render(<SavingsGoals />);
    fireEvent.click(screen.getByRole('button', { name: /add savings goal/i }));
    expect(screen.getByText(/Buckets cap what you spend; goals track what you.re saving toward\./)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Goal name (e.g. Christmas)'), { target: { value: 'Vacation' } });
    fireEvent.change(screen.getByPlaceholderText('Target amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /create goal/i }));

    expect(addSavingsGoalMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Vacation',
      targetAmount: 500,
      savedAmount: 0,
    }));
  });

  it('contributes an amount to an existing goal', () => {
    render(<SavingsGoals />);
    const [firstAddButton] = screen.getAllByRole('button', { name: 'Add' });
    expect(firstAddButton).toBeDefined();
    fireEvent.click(firstAddButton as HTMLElement);

    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: /add contribution/i }));

    expect(contributeToGoalMock).toHaveBeenCalledWith('goal1', 50);
  });

  it('disables the Add button for an already-completed goal', () => {
    render(<SavingsGoals />);
    // goal2 (New Bike) is second in the list and is complete.
    const [, secondAddButton] = screen.getAllByRole('button', { name: 'Add' });
    expect(secondAddButton).toBeDisabled();
  });

  it('offers a kid jar owner picker when a managed member exists', () => {
    render(<SavingsGoals />);
    fireEvent.click(screen.getByRole('button', { name: /add savings goal/i }));
    expect(screen.getByText("Leo's jar")).toBeInTheDocument();
  });
});
