
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HorizonCommandPalette from './HorizonCommandPalette';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { parseMagicAction } from '../../services/geminiService';
import { useNavigate } from 'react-router-dom';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext');
vi.mock('../../services/geminiService');
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

// Mock icons to avoid rendering issues
vi.mock('lucide-react', () => ({
  Search: () => <div data-testid="icon-search" />,
  Sparkles: () => <div data-testid="icon-sparkles" />,
  ArrowRight: () => <div data-testid="icon-arrow-right" />,
  Command: () => <div data-testid="icon-command" />,
  CreditCard: () => <div data-testid="icon-credit-card" />,
  CheckSquare: () => <div data-testid="icon-check-square" />,
  ShoppingCart: () => <div data-testid="icon-shopping-cart" />,
  LayoutDashboard: () => <div data-testid="icon-layout-dashboard" />,
  Activity: () => <div data-testid="icon-activity" />,
  Utensils: () => <div data-testid="icon-utensils" />,
  Settings: () => <div data-testid="icon-settings" />,
  Loader2: () => <div data-testid="icon-loader" />,
  Wallet: () => <div data-testid="icon-wallet" />,
}));

describe('HorizonCommandPalette', () => {
  const mockOnClose = vi.fn();
  const mockNavigate = vi.fn();
  const mockUseHousehold = useHousehold as jest.Mock;
  const mockParseMagicAction = parseMagicAction as jest.Mock;
  const mockAddTransaction = vi.fn();
  const mockAddToDo = vi.fn();
  const mockAddShoppingItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useNavigate as jest.Mock).mockReturnValue(mockNavigate);
    mockUseHousehold.mockReturnValue({
      householdId: 'test-household',
      buckets: [{ name: 'Groceries' }, { name: 'Gas' }],
      addTransaction: mockAddTransaction,
      addToDo: mockAddToDo,
      addShoppingItem: mockAddShoppingItem,
      currentUser: { uid: 'user-1' },
    });
  });

  it('does not render when closed', () => {
    render(<HorizonCommandPalette isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByPlaceholderText("Where to? or 'Spent $50 on gas'...")).not.toBeInTheDocument();
  });

  it('renders correctly when open', () => {
    render(<HorizonCommandPalette isOpen={true} onClose={mockOnClose} />);
    expect(screen.getByPlaceholderText("Where to? or 'Spent $50 on gas'...")).toBeInTheDocument();
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
  });

  it('filters commands based on input', () => {
    render(<HorizonCommandPalette isOpen={true} onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText("Where to? or 'Spent $50 on gas'...");

    fireEvent.change(input, { target: { value: 'Budget' } });

    expect(screen.getByText('Go to Budget')).toBeInTheDocument();
    expect(screen.queryByText('Go to Dashboard')).not.toBeInTheDocument();
  });

  it('shows magic action option for longer queries', () => {
    render(<HorizonCommandPalette isOpen={true} onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText("Where to? or 'Spent $50 on gas'...");

    fireEvent.change(input, { target: { value: 'Buy milk' } });

    expect(screen.getByText('Ask Horizon: "Buy milk"')).toBeInTheDocument();
  });

  it('executes navigation command on click', () => {
    render(<HorizonCommandPalette isOpen={true} onClose={mockOnClose} />);
    const budgetOption = screen.getByText('Go to Budget');

    fireEvent.click(budgetOption);

    expect(mockNavigate).toHaveBeenCalledWith('/budget');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('executes magic action correctly', async () => {
    mockParseMagicAction.mockResolvedValue({
      type: 'todo',
      data: { text: 'Buy milk', completeByDate: '2023-10-27' },
    });

    render(<HorizonCommandPalette isOpen={true} onClose={mockOnClose} />);
    const input = screen.getByPlaceholderText("Where to? or 'Spent $50 on gas'...");

    fireEvent.change(input, { target: { value: 'Buy milk' } });

    const magicOption = await screen.findByText('Ask Horizon: "Buy milk"');
    fireEvent.click(magicOption);

    expect(screen.getByTestId('icon-loader')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockParseMagicAction).toHaveBeenCalled();
      expect(mockAddToDo).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Buy milk',
        completeByDate: '2023-10-27'
      }));
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
