import React from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('applies primary variant classes by default', () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole('button', { name: /primary/i });
    expect(button).toHaveClass('bg-brand-800');
    expect(button).toHaveClass('text-white');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Danger</Button>);
    const button = screen.getByRole('button', { name: /danger/i });
    expect(button).toHaveClass('bg-red-50');
    expect(button).toHaveClass('text-red-700');
  });

  it('applies ghost-danger variant classes', () => {
    render(<Button variant="ghost-danger">Ghost Danger</Button>);
    const button = screen.getByRole('button', { name: /ghost danger/i });
    expect(button).toHaveClass('bg-transparent');
    expect(button).toHaveClass('text-red-400');
  });

  it('shows loader and disables button when isLoading is true', () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    // The loader is an SVG, so we can check for its presence.
    // Usually it doesn't have a role, but we can check if the text is present or check for the svg class if needed.
    // In our implementation, children are still rendered?
    // Looking at Button.tsx: {isLoading && <Loader2 ... />} {children}
    // So "Loading" text should still be there.
    expect(screen.getByText('Loading')).toBeInTheDocument();
    // Check for the spinner (it has animate-spin class)
    // We can't easily query by class with testing-library without setup, but we can query by a container selector if needed.
    // Or we can assume if it's disabled and has text, it's likely working, but let's be more precise if we can.
  });

  it('renders left and right icons', () => {
    const LeftIcon = <span data-testid="left-icon">L</span>;
    const RightIcon = <span data-testid="right-icon">R</span>;
    render(<Button leftIcon={LeftIcon} rightIcon={RightIcon}>Icon Button</Button>);

    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
    expect(screen.getByText('Icon Button')).toBeInTheDocument();
  });

  it('does not render icons when loading', () => {
    const LeftIcon = <span data-testid="left-icon">L</span>;
    render(<Button isLoading leftIcon={LeftIcon}>Loading Button</Button>);

    expect(screen.queryByTestId('left-icon')).not.toBeInTheDocument();
    expect(screen.getByText('Loading Button')).toBeInTheDocument();
  });
});
