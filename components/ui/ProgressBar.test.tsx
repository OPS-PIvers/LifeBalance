import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

describe('ProgressBar', () => {
  it('renders correctly', () => {
    render(<ProgressBar value={50} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('calculates width correctly', () => {
    const { container } = render(<ProgressBar value={50} max={100} />);
    // The inner div should have width: 50%
    const innerDiv = container.firstChild?.firstChild;
    expect(innerDiv).toHaveStyle({ width: '50%' });
  });

  it('clamps value between 0 and 100%', () => {
    const { container } = render(<ProgressBar value={150} max={100} />);
    const innerDiv = container.firstChild?.firstChild;
    expect(innerDiv).toHaveStyle({ width: '100%' });

    const { container: container2 } = render(<ProgressBar value={-50} max={100} />);
    const innerDiv2 = container2.firstChild?.firstChild;
    expect(innerDiv2).toHaveStyle({ width: '0%' });
  });

  it('applies size classes', () => {
    const { rerender, container } = render(<ProgressBar value={50} size="sm" />);
    expect(container.firstChild).toHaveClass('h-1.5');

    rerender(<ProgressBar value={50} size="md" />);
    expect(container.firstChild).toHaveClass('h-2');

    rerender(<ProgressBar value={50} size="lg" />);
    expect(container.firstChild).toHaveClass('h-3');

    rerender(<ProgressBar value={50} size="xl" />);
    expect(container.firstChild).toHaveClass('h-4');
  });

  it('applies custom color classes', () => {
    const { container } = render(
      <ProgressBar value={50} colorClass="bg-red-500" trackColorClass="bg-gray-200" />
    );
    const outerDiv = container.firstChild;
    const innerDiv = outerDiv?.firstChild;

    expect(outerDiv).toHaveClass('bg-gray-200');
    expect(innerDiv).toHaveClass('bg-red-500');
  });

  it('applies animation by default', () => {
    const { container } = render(<ProgressBar value={50} />);
    const innerDiv = container.firstChild?.firstChild;
    expect(innerDiv).toHaveClass('transition-all');
    expect(innerDiv).toHaveClass('duration-500');
  });

  it('can disable animation', () => {
    const { container } = render(<ProgressBar value={50} showAnimation={false} />);
    const innerDiv = container.firstChild?.firstChild;
    expect(innerDiv).not.toHaveClass('transition-all');
  });

  it('supports aria-label', () => {
    render(<ProgressBar value={50} aria-label="Loading progress" />);
    expect(screen.getByRole('progressbar', { name: /loading progress/i })).toBeInTheDocument();
  });
});
