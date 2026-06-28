import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModuleKey, ToDo, Transaction } from '@/types/schema';
import { ActivityFeedWidget } from './ActivityFeedWidget';
import { useFinance, useTodos } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useTodos: vi.fn(),
}));

vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number) => `$${amount}`,
}));

vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
  });
};

const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    amount: 42,
    merchant: 'Coffee Shop',
    category: 'Dining',
    date: '2026-06-16',
    createdAt: '2026-06-16T09:00:00.000Z',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as unknown as Transaction);

const makeTodo = (overrides: Partial<ToDo> = {}): ToDo =>
  ({
    id: 'todo-1',
    text: 'Take out trash',
    completeByDate: '2026-06-15',
    assignedTo: 'uid-1',
    isCompleted: true,
    completedAt: '2026-06-16T08:00:00.000Z',
    createdBy: 'uid-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as unknown as ToDo);

const setData = () => {
  vi.mocked(useFinance).mockReturnValue({
    transactions: [makeTransaction()],
  } as unknown as ReturnType<typeof useFinance>);
  vi.mocked(useTodos).mockReturnValue({
    todos: [makeTodo()],
  } as unknown as ReturnType<typeof useTodos>);
};

describe('ActivityFeedWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setData();
    setEnabledModules(['money', 'habits', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('shows both transaction and completed-todo rows when all on', () => {
    render(<ActivityFeedWidget />);
    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    expect(screen.getByText('Take out trash')).toBeInTheDocument();
  });

  it('drops transaction rows when money is off', () => {
    setEnabledModules(['habits', 'plan', 'todos']);
    render(<ActivityFeedWidget />);
    expect(screen.queryByText('Coffee Shop')).not.toBeInTheDocument();
    expect(screen.getByText('Take out trash')).toBeInTheDocument();
  });

  it('drops completed-todo rows when the Plan→To-Dos destination is off', () => {
    // todos flag on but Plan master off → To-Dos page unreachable.
    setEnabledModules(['money', 'habits', 'todos']);
    render(<ActivityFeedWidget />);
    expect(screen.getByText('Coffee Shop')).toBeInTheDocument();
    expect(screen.queryByText('Take out trash')).not.toBeInTheDocument();
  });

  it('hides the whole widget when both domains are off', () => {
    setEnabledModules(['habits']);
    const { container } = render(<ActivityFeedWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
