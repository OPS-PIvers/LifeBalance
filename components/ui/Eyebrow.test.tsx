import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Eyebrow from './Eyebrow';

describe('Eyebrow', () => {
  it('renders children with the canonical micro-caps classes', () => {
    render(<Eyebrow>Section</Eyebrow>);
    expect(screen.getByText('Section')).toHaveClass(
      'text-xs',
      'font-semibold',
      'uppercase',
      'tracking-wider'
    );
  });

  it('renders a span by default', () => {
    const { container } = render(<Eyebrow>Label</Eyebrow>);
    expect(container.querySelector('span')).toBeInTheDocument();
  });

  it('renders the element given by `as`', () => {
    render(<Eyebrow as="h2">Heading</Eyebrow>);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Heading' })
    ).toBeInTheDocument();
  });

  it('defaults to the brand tone', () => {
    render(<Eyebrow>Default</Eyebrow>);
    expect(screen.getByText('Default')).toHaveClass('text-brand-500');
  });

  it('applies the warm tone', () => {
    render(<Eyebrow tone="warm">Streak</Eyebrow>);
    expect(screen.getByText('Streak')).toHaveClass('text-warm-600');
  });

  it('merges a custom className', () => {
    render(<Eyebrow className="mb-3">X</Eyebrow>);
    expect(screen.getByText('X')).toHaveClass('mb-3');
  });
});
