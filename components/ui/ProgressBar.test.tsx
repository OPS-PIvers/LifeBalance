import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders correctly', () => {
    render(<ProgressBar value={50} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '50');
  });

  it('calculates width based on value and max', () => {
    render(<ProgressBar value={75} max={100} />);
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '75');
  });

  it('applies size classes correctly', () => {
    const { rerender } = render(<ProgressBar value={50} size="sm" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-1.5');

    rerender(<ProgressBar value={50} size="md" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-2');

    rerender(<ProgressBar value={50} size="lg" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-3');

    rerender(<ProgressBar value={50} size="xl" />);
    expect(screen.getByRole('progressbar')).toHaveClass('h-4');
  });

  it('applies variant styles correctly (indirectly via inner div)', () => {
    const { container } = render(<ProgressBar value={50} colorClass="bg-custom-color" />);
    const innerDiv = container.querySelector('.bg-custom-color');
    expect(innerDiv).toBeInTheDocument();
  });

  it('applies trackColorClass correctly', () => {
    render(<ProgressBar value={50} trackColorClass="bg-track-custom" />);
    expect(screen.getByRole('progressbar')).toHaveClass('bg-track-custom');
  });

  it('shows label when showLabel is true', () => {
    render(<ProgressBar value={42} showLabel />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('merges custom className correctly', () => {
    const { container } = render(<ProgressBar value={50} className="custom-container-class" />);
    const outerDiv = container.firstChild;
    expect(outerDiv).toHaveClass('custom-container-class');
  });
});
