import { render, screen } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';
import { describe, it, expect } from 'vitest';

describe('ProgressBar', () => {
  it('renders correctly with default props', () => {
    render(<ProgressBar value={50} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute('aria-valuenow', '50');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '100');
  });

  it('renders correctly with custom props', () => {
    render(<ProgressBar value={75} max={200} size="lg" variant="success" />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '75');
    expect(progressBar).toHaveAttribute('aria-valuemax', '200');
    expect(progressBar).toHaveClass('h-3'); // lg size
  });
});
