import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState title="No budget buckets yet" description="Create some categories." />);
    expect(screen.getByRole('heading', { name: 'No budget buckets yet' })).toBeInTheDocument();
    expect(screen.getByText('Create some categories.')).toBeInTheDocument();
  });

  it('renders the icon badge only when an icon is provided', () => {
    const { container, rerender } = render(<EmptyState title="Empty" />);
    // No icon → no badge wrapper.
    expect(container.querySelector('.rounded-full')).toBeNull();

    rerender(<EmptyState title="Empty" icon={<svg data-testid="icon" />} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(container.querySelector('.rounded-full')).not.toBeNull();
  });

  it('renders the action slot', () => {
    render(<EmptyState title="Empty" action={<button>Create</button>} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('omits description and action markup when not provided', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('applies the surface wrapper for variant="surface"', () => {
    const { container } = render(<EmptyState title="Empty" variant="surface" />);
    expect(container.firstChild).toHaveClass('surface-section');
  });

  it('applies the dashed wrapper for variant="dashed"', () => {
    const { container } = render(<EmptyState title="Empty" variant="dashed" />);
    expect(container.firstChild).toHaveClass('border-dashed');
  });

  it('defaults to the plain variant (no surface of its own)', () => {
    const { container } = render(<EmptyState title="Empty" />);
    const root = container.firstChild as HTMLElement;
    expect(root).not.toHaveClass('surface-section');
    expect(root).not.toHaveClass('border-dashed');
    expect(root).toHaveClass('text-center');
  });

  it('merges a custom className', () => {
    const { container } = render(<EmptyState title="Empty" className="mt-8" />);
    expect(container.firstChild).toHaveClass('mt-8');
  });

  it('uses the neutral icon-badge tone by default', () => {
    const { container } = render(
      <EmptyState title="Empty" icon={<svg data-testid="icon" />} />
    );
    expect(container.querySelector('.rounded-full')).toHaveClass('text-brand-400');
  });

  it('applies the danger icon-badge tone', () => {
    const { container } = render(
      <EmptyState title="Failed" tone="danger" icon={<svg data-testid="icon" />} />
    );
    expect(container.querySelector('.rounded-full')).toHaveClass('text-money-neg');
  });
});
