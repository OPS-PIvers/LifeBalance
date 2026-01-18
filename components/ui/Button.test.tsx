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

  // Variants tests
  it('applies primary variant classes by default', () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole('button', { name: /primary/i });
    expect(button).toHaveClass('bg-brand-800');
    expect(button).toHaveClass('text-white');
  });

  it('applies secondary variant classes', () => {
    render(<Button variant="secondary">Secondary</Button>);
    const button = screen.getByRole('button', { name: /secondary/i });
    expect(button).toHaveClass('bg-white');
    expect(button).toHaveClass('text-brand-600');
    expect(button).toHaveClass('border');
  });

  it('applies ghost variant classes', () => {
    render(<Button variant="ghost">Ghost</Button>);
    const button = screen.getByRole('button', { name: /ghost/i });
    expect(button).toHaveClass('bg-transparent');
    expect(button).toHaveClass('text-brand-600');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Danger</Button>);
    const button = screen.getByRole('button', { name: /danger/i });
    expect(button).toHaveClass('bg-red-50');
    expect(button).toHaveClass('text-red-700');
  });

  it('applies outline variant classes', () => {
    render(<Button variant="outline">Outline</Button>);
    const button = screen.getByRole('button', { name: /outline/i });
    expect(button).toHaveClass('bg-transparent');
    expect(button).toHaveClass('border-2');
    expect(button).toHaveClass('text-brand-600');
  });

  it('applies subtle variant classes', () => {
    render(<Button variant="subtle">Subtle</Button>);
    const button = screen.getByRole('button', { name: /subtle/i });
    expect(button).toHaveClass('bg-brand-100');
    expect(button).toHaveClass('text-brand-700');
  });

  it('applies ghost-danger variant classes', () => {
    render(<Button variant="ghost-danger">Ghost Danger</Button>);
    const button = screen.getByRole('button', { name: /ghost danger/i });
    expect(button).toHaveClass('bg-transparent');
    expect(button).toHaveClass('text-red-400');
  });

  // Size tests
  it('applies sm size classes', () => {
    render(<Button size="sm">Small</Button>);
    const button = screen.getByRole('button', { name: /small/i });
    expect(button).toHaveClass('px-3');
    expect(button).toHaveClass('py-1');
    expect(button).toHaveClass('text-sm');
  });

  it('applies md size classes by default', () => {
    render(<Button>Medium</Button>);
    const button = screen.getByRole('button', { name: /medium/i });
    expect(button).toHaveClass('px-4');
    expect(button).toHaveClass('py-2');
    expect(button).toHaveClass('text-sm');
  });

  it('applies lg size classes', () => {
    render(<Button size="lg">Large</Button>);
    const button = screen.getByRole('button', { name: /large/i });
    expect(button).toHaveClass('px-6');
    expect(button).toHaveClass('py-3');
    expect(button).toHaveClass('text-base');
  });

  it('applies icon size classes', () => {
    render(<Button size="icon">Icon</Button>);
    const button = screen.getByRole('button', { name: /icon/i });
    expect(button).toHaveClass('p-2');
  });

  // State & Icon tests
  it('shows loader and disables button when isLoading is true', () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.getByText('Loading')).toBeInTheDocument();
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
