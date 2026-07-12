import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Check, Trash2 } from 'lucide-react';
import { SwipeActionRow, type SwipeAction } from './SwipeActionRow';

const completeAction: SwipeAction = {
  icon: Check,
  label: 'Complete',
  tone: 'positive',
  onAction: vi.fn(),
};

const deleteAction: SwipeAction = {
  icon: Trash2,
  label: 'Delete',
  tone: 'destructive',
  onAction: vi.fn(),
};

describe('SwipeActionRow', () => {
  it('renders its children', () => {
    render(
      <SwipeActionRow startActions={[completeAction]} endActions={[deleteAction]}>
        <div>Row content</div>
      </SwipeActionRow>
    );
    expect(screen.getByText('Row content')).toBeInTheDocument();
  });

  it('renders both action zones as affordances, not tap targets, while closed', () => {
    render(
      <SwipeActionRow startActions={[completeAction]} endActions={[deleteAction]}>
        <div>Row content</div>
      </SwipeActionRow>
    );
    // Closed rows hide the zone buttons from AT and the tab order — they only
    // become real buttons when a partial swipe sticks the row open.
    const buttons = screen.getAllByRole('button', { hidden: true });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toHaveAttribute('aria-hidden', 'true');
      expect(button).toHaveAttribute('tabindex', '-1');
      expect(button.className).toContain('pointer-events-none');
    }
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('renders only the zones for the actions provided', () => {
    render(
      <SwipeActionRow endActions={[deleteAction]}>
        <div>Row content</div>
      </SwipeActionRow>
    );
    expect(screen.getAllByRole('button', { hidden: true })).toHaveLength(1);
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
  });

  it('renders every action of a multi-action side, primary at the outer edge', () => {
    const deferAction: SwipeAction = {
      icon: Check,
      label: 'Defer',
      tone: 'warm',
      onAction: vi.fn(),
    };
    render(
      // Primary first per the API contract; on the end (right) side it must
      // render LAST so it sits at the outer (right) edge, Apple Mail-style.
      <SwipeActionRow endActions={[deferAction, deleteAction]}>
        <div>Row content</div>
      </SwipeActionRow>
    );
    const buttons = screen.getAllByRole('button', { hidden: true });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Delete');
    expect(buttons[1]).toHaveTextContent('Defer');
  });

  it('renders a static row (no action zones) when disabled', () => {
    render(
      <SwipeActionRow startActions={[completeAction]} endActions={[deleteAction]} disabled>
        <div>Row content</div>
      </SwipeActionRow>
    );
    expect(screen.getByText('Row content')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { hidden: true })).toHaveLength(0);
  });

  it('renders a static row when no actions are provided', () => {
    render(
      <SwipeActionRow>
        <div>Row content</div>
      </SwipeActionRow>
    );
    expect(screen.getByText('Row content')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { hidden: true })).toHaveLength(0);
  });
});
