import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders with default props', () => {
    render(<ProgressBar value={50} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    expect(progressBar).toHaveClass('h-2'); // Default size is md (h-2)
    expect(progressBar).toHaveClass('bg-slate-100'); // Default track color
  });

  it('renders with correct width percentage', () => {
    render(<ProgressBar value={75} data-testid="progress-bar" />);
    // We need to check the inner div for width
    // Since we don't have a specific test id on the inner div, we can find it by class or structure
    // Or we can rely on the style attribute if we can access the inner div.
    // However, strictly speaking, testing style is tricky.
    // Let's check if the inner div has the width style.
    const progressBar = screen.getByRole('progressbar');
    const innerBar = progressBar.firstElementChild;
    expect(innerBar).toHaveStyle({ width: '75%' });
  });

  it('clamps value between 0 and 100', () => {
    const { rerender } = render(<ProgressBar value={150} />);
    const progressBar = screen.getByRole('progressbar');
    const innerBar = progressBar.firstElementChild;
    expect(innerBar).toHaveStyle({ width: '100%' });

    rerender(<ProgressBar value={-20} />);
    expect(innerBar).toHaveStyle({ width: '0%' });
  });

  it('renders different sizes', () => {
    const { rerender } = render(<ProgressBar value={50} size="sm" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-1.5');

    rerender(<ProgressBar value={50} size="lg" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-3');

    rerender(<ProgressBar value={50} size="xl" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-4');
  });

  it('renders variants', () => {
    const { container } = render(<ProgressBar value={50} variant="success" />);
    // Searching for the inner div which should have the variant class
    const innerBar = container.querySelector('.bg-money-pos');
    expect(innerBar).toBeInTheDocument();
  });

  it('renders custom color class', () => {
    const { container } = render(<ProgressBar value={50} variant="custom" colorClass="bg-purple-500" />);
    const innerBar = container.querySelector('.bg-purple-500');
    expect(innerBar).toBeInTheDocument();
  });

  it('supports custom class names', () => {
    render(<ProgressBar value={50} className="custom-track" barClassName="custom-bar" />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveClass('custom-track');
    expect(progressBar.firstElementChild).toHaveClass('custom-bar');
  });

  it('renders max value prop correctly', () => {
    render(<ProgressBar value={50} max={200} />);
    const progressBar = screen.getByRole('progressbar');
    const innerBar = progressBar.firstElementChild;
    // 50 / 200 = 25%
    expect(innerBar).toHaveStyle({ width: '25%' });
    expect(progressBar).toHaveAttribute('aria-valuemax', '200');
  });
});
