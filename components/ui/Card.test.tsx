import { render, screen } from '@testing-library/react';
import Card from './Card';
import { describe, it, expect } from 'vitest';

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Test Content</Card>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies base grounded-surface classes', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild;
    // Grouped-flat language: solid surface + hairline border + deliberate radius,
    // no glass blur / floating shadow.
    expect(card).toHaveClass('bg-white');
    expect(card).toHaveClass('rounded-card');
    expect(card).toHaveClass('border');
    expect(card).not.toHaveClass('backdrop-blur-xl');
  });

  it('merges custom className correctly', () => {
    const { container } = render(<Card className="custom-class p-8">Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('custom-class');
    expect(card).toHaveClass('p-8');
    // Should still have base classes
    expect(card).toHaveClass('rounded-card');
  });

  it('allows overriding base classes via className', () => {
    // Tailwind-merge should handle this, but we're testing that the prop is passed to cn()
    const { container } = render(<Card className="shadow-none">Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('shadow-none');
    // Depending on tailwind-merge configuration, shadow-glass might be removed or present but overridden.
    // In many setups with cn(), the last class wins in the generated string, or is deduped.
    // We just check that shadow-none is present.
  });

  it('adds a hover/press affordance when interactive', () => {
    const { container } = render(<Card interactive>Content</Card>);
    expect(container.firstChild).toHaveClass('cursor-pointer', 'active:scale-[0.98]');
  });

  it('has no interactive affordance by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstChild).not.toHaveClass('cursor-pointer');
  });
});
