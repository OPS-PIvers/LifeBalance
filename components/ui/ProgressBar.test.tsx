import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProgressBar from './ProgressBar';

describe('ProgressBar', () => {
  it('renders a progressbar with the rounded percentage in aria-valuenow', () => {
    render(<ProgressBar value={250} max={500} ariaLabel="Groceries spending" />);
    const bar = screen.getByRole('progressbar', { name: 'Groceries spending' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('defaults max to 100 (value is treated as a percentage)', () => {
    render(<ProgressBar value={42} ariaLabel="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('sets the fill width from value/max and applies barClassName to the fill', () => {
    const { container } = render(
      <ProgressBar value={250} max={500} barClassName="bg-green-500" ariaLabel="x" />
    );
    const track = container.querySelector('[role="progressbar"]');
    const fill = track?.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle('width: 50%');
    expect(fill).toHaveClass('bg-green-500');
  });

  it('does not clamp the reported value when over max (overspent buckets)', () => {
    const { container } = render(<ProgressBar value={150} max={100} ariaLabel="x" />);
    const track = container.querySelector('[role="progressbar"]');
    expect(track).toHaveAttribute('aria-valuenow', '150');
    expect(track?.firstElementChild).toHaveStyle('width: 150%');
  });

  it('falls back to a "<pct>%" aria-label when none is given', () => {
    render(<ProgressBar value={30} />);
    expect(screen.getByRole('progressbar', { name: '30%' })).toBeInTheDocument();
  });

  it('applies className to the track', () => {
    const { container } = render(<ProgressBar value={10} className="h-2 bg-brand-100 mb-4" ariaLabel="x" />);
    const track = container.querySelector('[role="progressbar"]');
    expect(track).toHaveClass('h-2', 'bg-brand-100', 'mb-4', 'overflow-hidden');
  });

  it('treats a zero max as 0%', () => {
    render(<ProgressBar value={5} max={0} ariaLabel="x" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('guards against NaN (division-by-zero upstream) → 0%', () => {
    const { container } = render(<ProgressBar value={NaN} ariaLabel="x" />);
    const track = container.querySelector('[role="progressbar"]');
    expect(track).toHaveAttribute('aria-valuenow', '0');
    expect(track?.firstElementChild).toHaveStyle('width: 0%');
  });

  it('clamps a negative value to 0% (never reports a negative width/aria)', () => {
    const { container } = render(<ProgressBar value={-25} ariaLabel="x" />);
    const track = container.querySelector('[role="progressbar"]');
    expect(track).toHaveAttribute('aria-valuenow', '0');
    expect(track?.firstElementChild).toHaveStyle('width: 0%');
  });
});
