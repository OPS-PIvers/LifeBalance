import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders children correctly', () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByText('Test Badge')).toBeInTheDocument();
  });

  it('applies default styles', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toHaveClass('bg-accent-50', 'text-accent-700', 'text-xs');
  });

  it('applies variant styles correctly', () => {
    const { rerender } = render(<Badge variant="success">Success</Badge>);
    expect(screen.getByText('Success')).toHaveClass('bg-money-bgPos', 'text-money-pos dark:text-money-posDark');

    rerender(<Badge variant="danger">Danger</Badge>);
    expect(screen.getByText('Danger')).toHaveClass('bg-money-bgNeg', 'text-money-neg dark:text-money-negDark');

    rerender(<Badge variant="warning">Warning</Badge>);
    expect(screen.getByText('Warning')).toHaveClass('bg-warm-50', 'text-warm-700');
  });

  it('applies size styles correctly', () => {
    const { rerender } = render(<Badge size="sm">Small</Badge>);
    expect(screen.getByText('Small')).toHaveClass('text-xxs', 'px-2', 'py-0.5');

    rerender(<Badge size="md">Medium</Badge>);
    expect(screen.getByText('Medium')).toHaveClass('text-xs', 'px-2.5', 'py-0.5');
  });

  // Regression: `text-xxs` is a custom @theme token that tailwind-merge
  // misreads as a text-COLOUR utility, so routing it through cn() alongside the
  // variant's `text-<colour>` silently dropped one of the two. Every
  // size="sm" badge lost its semantic colour. Both must survive.
  it('keeps the variant colour AND the custom font size at size="sm"', () => {
    const { rerender } = render(<Badge variant="danger" size="sm">Danger</Badge>);
    expect(screen.getByText('Danger')).toHaveClass('text-xxs', 'text-money-neg', 'bg-money-bgNeg');

    rerender(<Badge variant="success" size="sm">Success</Badge>);
    expect(screen.getByText('Success')).toHaveClass('text-xxs', 'text-money-pos');

    rerender(<Badge variant="warning" size="sm">Warning</Badge>);
    expect(screen.getByText('Warning')).toHaveClass('text-xxs', 'text-warm-700');

    rerender(<Badge variant="neutral" size="sm">Neutral</Badge>);
    expect(screen.getByText('Neutral')).toHaveClass('text-xxs', 'text-brand-600');

    rerender(<Badge variant="outline" size="sm">Outline</Badge>);
    expect(screen.getByText('Outline')).toHaveClass('text-xxs', 'text-brand-600');
  });

  it('lets className override the variant colour without eating the font size', () => {
    render(<Badge variant="default" size="sm" className="text-habit-blue">Override</Badge>);
    const badge = screen.getByText('Override');
    expect(badge).toHaveClass('text-xxs', 'text-habit-blue');
    expect(badge).not.toHaveClass('text-accent-700');
  });

  it('merges custom className correctly', () => {
    render(<Badge className="custom-class">Custom</Badge>);
    const badge = screen.getByText('Custom');
    expect(badge).toHaveClass('custom-class');
    expect(badge).toHaveClass('inline-flex'); // Ensures base classes are still present
  });
});
