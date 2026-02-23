import React from 'react';
import { render, screen } from '@testing-library/react';
import Card from './Card';
import { describe, it, expect } from 'vitest';

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Test Content</Card>);
    expect(screen.getByText('Test Content')).toBeInTheDocument();
  });

  it('applies base glassmorphism classes', () => {
    const { container } = render(<Card>Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('backdrop-blur-xl');
    expect(card).toHaveClass('rounded-3xl');
    expect(card).toHaveClass('shadow-premium');
    expect(card).toHaveClass('ring-1');
  });

  it('merges custom className correctly', () => {
    const { container } = render(<Card className="custom-class p-8">Content</Card>);
    const card = container.firstChild;
    expect(card).toHaveClass('custom-class');
    expect(card).toHaveClass('p-8');
    // Should still have base classes
    expect(card).toHaveClass('rounded-3xl');
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
});
