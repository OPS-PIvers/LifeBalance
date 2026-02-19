import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProgressBar from './ProgressBar';

describe('ProgressBar', () => {
  it('renders correctly with default props', () => {
    render(<ProgressBar value={50} ariaLabel="test-progress" />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveClass('h-2'); // default size md
    expect(progressBar).toHaveClass('bg-slate-100'); // default track color
  });

  it('calculates width based on value and max', () => {
    render(<ProgressBar value={50} max={200} ariaLabel="test-progress" />);
    const progressBar = screen.getByRole('progressbar');
    const innerBar = progressBar.firstChild as HTMLElement;
    expect(innerBar).toHaveStyle('width: 25%');
  });

  it('clamps value between 0 and 100%', () => {
    const { rerender } = render(<ProgressBar value={150} max={100} ariaLabel="test-progress" />);
    let progressBar = screen.getByRole('progressbar');
    let innerBar = progressBar.firstChild as HTMLElement;
    expect(innerBar).toHaveStyle('width: 100%');

    rerender(<ProgressBar value={-50} max={100} ariaLabel="test-progress" />);
    progressBar = screen.getByRole('progressbar');
    innerBar = progressBar.firstChild as HTMLElement;
    expect(innerBar).toHaveStyle('width: 0%');
  });

  it('applies size classes correctly', () => {
    const { rerender } = render(<ProgressBar value={50} size="sm" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-1.5');

    rerender(<ProgressBar value={50} size="lg" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-3');
  });

  it('applies variant classes correctly', () => {
    const { rerender } = render(<ProgressBar value={50} variant="success" />);
    const successBar = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(successBar).toHaveClass('bg-money-pos');

    rerender(<ProgressBar value={50} variant="danger" />);
    const dangerBar = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(dangerBar).toHaveClass('bg-money-neg');
  });

  it('applies custom color class', () => {
    render(<ProgressBar value={50} variant="custom" colorClass="bg-purple-500" />);
    const customBar = screen.getByRole('progressbar').firstChild as HTMLElement;
    expect(customBar).toHaveClass('bg-purple-500');
  });

  it('allows overriding track color', () => {
    render(<ProgressBar value={50} trackColorClass="bg-red-500" />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveClass('bg-red-500');
  });
});
