import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, Mock } from 'vitest';
import React from 'react';
import HabitCard from './HabitCard';
import { Habit } from '../../types/schema';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

// Mock child modals
vi.mock('../modals/HabitFormModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen ? <div data-testid="edit-modal" onClick={onClose}>Edit Modal</div> : null
}));

vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => isOpen ? <div data-testid="log-modal" onClick={onClose}>Log Modal</div> : null
}));

// Mock Drawer to render children directly
vi.mock('../ui/Drawer', () => ({
  Drawer: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => isOpen ? <div role="dialog" data-testid="drawer">{children}</div> : null
}));

// Mock useMediaQuery
vi.mock('../../hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(),
}));

import { useMediaQuery } from '../../hooks/useMediaQuery';

describe('HabitCard', () => {
  const mockToggleHabit = vi.fn();
  const mockDeleteHabit = vi.fn();
  const mockResetHabit = vi.fn();
  const mockActiveChallenge = { relatedHabitIds: [] };

  const defaultHabit: Habit = {
    id: 'habit-1',
    title: 'Drink Water',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 5,
    count: 2,
    totalCount: 20,
    completedDates: [],
    streakDays: 3,
    lastUpdated: '2023-10-27',
    weatherSensitive: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as unknown as Mock).mockReturnValue({
      toggleHabit: mockToggleHabit,
      deleteHabit: mockDeleteHabit,
      resetHabit: mockResetHabit,
      activeChallenge: mockActiveChallenge,
    });
  });

  it('renders dropdown menu on desktop', async () => {
    // Desktop view
    (useMediaQuery as unknown as Mock).mockReturnValue(true);

    render(<HabitCard habit={defaultHabit} />);

    // Open menu
    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    // Check for dropdown menu (role="menu")
    const menu = await screen.findByRole('menu');
    expect(menu).toBeInTheDocument();

    // Check that Drawer is NOT rendered
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('renders Drawer menu on mobile', async () => {
    // Mobile view
    (useMediaQuery as unknown as Mock).mockReturnValue(false);

    render(<HabitCard habit={defaultHabit} />);

    // Open menu
    const menuButton = screen.getByLabelText('Habit options menu');
    fireEvent.click(menuButton);

    // Check for Drawer (role="dialog" from our mock)
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toBeInTheDocument();
  });
});
