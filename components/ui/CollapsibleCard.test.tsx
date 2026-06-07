import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleCard } from './CollapsibleCard';
import { describe, it, expect, vi } from 'vitest';

describe('CollapsibleCard', () => {
  it('renders title and icon', () => {
    render(
      <CollapsibleCard title="Test Card" icon={<span data-testid="icon">icon</span>}>
        <div>Content</div>
      </CollapsibleCard>
    );

    expect(screen.getByText('Test Card')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders children but hides them initially (uncontrolled)', () => {
    render(
      <CollapsibleCard title="Test Card">
        <div>Hidden Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Check for the content container with hidden styles
    const contentRegion = screen.getByRole('region', { hidden: true });
    expect(contentRegion).toHaveClass('grid-rows-[0fr]');
  });

  it('toggles content on click (uncontrolled)', () => {
    render(
      <CollapsibleCard title="Test Card">
        <div>Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });
    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    const contentRegion = screen.getByRole('region');
    expect(contentRegion).toHaveClass('grid-rows-[1fr]');
  });

  it('respects defaultOpen prop (uncontrolled)', () => {
    render(
      <CollapsibleCard title="Test Card" defaultOpen={true}>
        <div>Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('respects isOpen prop (controlled)', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleCard title="Test Card" isOpen={true} onToggle={onToggle}>
        <div>Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // Clicking should call onToggle but NOT change state internally if props don't change
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledWith(false);
    expect(button).toHaveAttribute('aria-expanded', 'true'); // Still true because prop didn't change

    // Rerender with new prop
    rerender(
      <CollapsibleCard title="Test Card" isOpen={false} onToggle={onToggle}>
        <div>Content</div>
      </CollapsibleCard>
    );
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports keyboard navigation (Enter/Space)', () => {
    render(
      <CollapsibleCard title="Test Card">
        <div>Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });

    // Enter key
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(button).toHaveAttribute('aria-expanded', 'true');

    // Space key
    fireEvent.keyDown(button, { key: ' ' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('generates stable IDs for accessibility', () => {
    render(
      <CollapsibleCard title="Test Card">
        <div>Content</div>
      </CollapsibleCard>
    );

    const button = screen.getByRole('button', { name: /Test Card/i });
    const region = screen.getByRole('region', { hidden: true });

    const controlsId = button.getAttribute('aria-controls');
    const labelledById = region.getAttribute('aria-labelledby');

    expect(controlsId).toBe(region.id);
    expect(labelledById).toBe(button.querySelector('h3')?.id);
  });
});
