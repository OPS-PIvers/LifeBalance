import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { HashRouter } from 'react-router-dom';
import BottomNav from './BottomNav';

// Mock CaptureModal to avoid testing its internals
vi.mock('../modals/CaptureModal', () => ({
  default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? <div data-testid="capture-modal" onClick={onClose}>Capture Modal</div> : null
  ),
}));

describe('BottomNav', () => {
  it('renders navigation links', () => {
    render(
      <HashRouter>
        <BottomNav />
      </HashRouter>
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Habits')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('Lists')).toBeInTheDocument();
  });

  it('renders the FAB button', () => {
    render(
      <HashRouter>
        <BottomNav />
      </HashRouter>
    );
    const fab = screen.getByLabelText('Add Transaction');
    expect(fab).toBeInTheDocument();
    // Verify it is a button - initially raw button, later Button component (which renders a button)
    expect(fab.tagName).toBe('BUTTON');
  });

  it('opens modal on FAB click', () => {
    render(
      <HashRouter>
        <BottomNav />
      </HashRouter>
    );
    const fab = screen.getByLabelText('Add Transaction');
    fireEvent.click(fab);
    expect(screen.getByTestId('capture-modal')).toBeInTheDocument();
  });
});
