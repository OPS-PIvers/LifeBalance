import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import CountBadge from './CountBadge';

describe('CountBadge', () => {
  it('renders the count', () => {
    render(<CountBadge count={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders nothing when count is 0 or negative', () => {
    const { container, rerender } = render(<CountBadge count={0} />);
    expect(container.firstChild).toBeNull();
    rerender(<CountBadge count={-1} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for NaN (defensive guard)', () => {
    const { container } = render(<CountBadge count={NaN} />);
    expect(container.firstChild).toBeNull();
  });

  it('clamps to "9+" above the default max of 9', () => {
    render(<CountBadge count={42} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });

  it('honors a custom max', () => {
    render(<CountBadge count={150} max={99} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('is aria-hidden (the host control owns the accessible label)', () => {
    const { container } = render(<CountBadge count={3} />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('merges position/ring overrides via className', () => {
    const { container } = render(<CountBadge count={3} className="-top-2 z-10 ring-brand-800" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge).toHaveClass('-top-2', 'z-10', 'ring-brand-800');
    // base classes still present
    expect(badge).toHaveClass('rounded-full', 'bg-money-neg');
  });
});
