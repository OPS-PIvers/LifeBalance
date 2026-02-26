import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

describe('ProgressBar', () => {
  it('renders with default props', () => {
    render(<ProgressBar value={50} aria-label="test-progress" />);
    const progressBar = screen.getByRole('progressbar', { name: /test-progress/i });
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveClass('h-2'); // default size md
    expect(progressBar).toHaveClass('bg-slate-100'); // default track color
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders correct size classes', () => {
    const sizes = {
      xs: 'h-1',
      sm: 'h-1.5',
      md: 'h-2',
      lg: 'h-3',
      xl: 'h-4',
    } as const;

    Object.entries(sizes).forEach(([size, heightClass]) => {
      const { container } = render(
        <ProgressBar value={30} size={size as keyof typeof sizes} />
      );
      // We look for the outer div which has the role progressbar
      // But since we are rendering multiple times in a loop, it's safer to query by container
      expect(container.firstChild).toHaveClass(heightClass);
    });
  });

  it('applies custom color classes', () => {
    render(
      <ProgressBar
        value={75}
        colorClass="bg-blue-500"
        trackColorClass="bg-gray-200"
        aria-label="colored-progress"
      />
    );
    const progressBar = screen.getByRole('progressbar', { name: /colored-progress/i });
    expect(progressBar).toHaveClass('bg-gray-200');
    // The indicator is the inner div, we can find it by checking children or style
    const indicator = progressBar.firstChild;
    expect(indicator).toHaveClass('bg-blue-500');
  });

  it('calculates percentage correctly', () => {
    render(<ProgressBar value={50} max={200} aria-label="percent-check" />);
    const progressBar = screen.getByRole('progressbar', { name: /percent-check/i });
    const indicator = progressBar.firstChild as HTMLElement;
    // 50 / 200 = 25%
    expect(indicator.style.width).toBe('25%');
  });

  it('clamps percentage between 0 and 100', () => {
    render(
      <>
        <ProgressBar value={-10} aria-label="underflow" />
        <ProgressBar value={150} max={100} aria-label="overflow" />
      </>
    );

    const underflowBar = screen.getByRole('progressbar', { name: /underflow/i });
    expect((underflowBar.firstChild as HTMLElement).style.width).toBe('0%');

    const overflowBar = screen.getByRole('progressbar', { name: /overflow/i });
    expect((overflowBar.firstChild as HTMLElement).style.width).toBe('100%');
  });

  it('handles animation prop', () => {
    const { rerender } = render(<ProgressBar value={50} showAnimation={true} aria-label="animated" />);
    const animatedBar = screen.getByRole('progressbar', { name: /animated/i });
    expect(animatedBar.firstChild).toHaveClass('transition-all');

    rerender(<ProgressBar value={50} showAnimation={false} aria-label="no-animated" />);
    const noAnimatedBar = screen.getByRole('progressbar', { name: /no-animated/i });
    expect(noAnimatedBar.firstChild).not.toHaveClass('transition-all');
  });
});
