import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ProgressRing from './ProgressRing';

const progressPath = (container: HTMLElement) =>
  // The second <path> is the progress arc (the first is the track).
  container.querySelectorAll('path')[1] as SVGPathElement;

describe('ProgressRing', () => {
  it('maps percent to the progress arc strokeDasharray', () => {
    const { container } = render(<ProgressRing percent={65} />);
    expect(progressPath(container)).toHaveAttribute('stroke-dasharray', '65, 100');
  });

  it('clamps percent into 0–100', () => {
    const { container: over } = render(<ProgressRing percent={140} />);
    expect(progressPath(over)).toHaveAttribute('stroke-dasharray', '100, 100');
    const { container: under } = render(<ProgressRing percent={-20} />);
    expect(progressPath(under)).toHaveAttribute('stroke-dasharray', '0, 100');
  });

  it('is aria-hidden by default (value shown as adjacent text)', () => {
    const { container } = render(<ProgressRing percent={50} />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes an img with a label when ringLabel is provided', () => {
    render(<ProgressRing percent={50} ringLabel="Daily habits 50% complete" />);
    expect(screen.getByRole('img', { name: 'Daily habits 50% complete' })).toBeInTheDocument();
  });

  it('renders centered children', () => {
    render(<ProgressRing percent={50}><span>50%</span></ProgressRing>);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('applies the stroke width to both arcs', () => {
    const { container } = render(<ProgressRing percent={50} strokeWidth={3} />);
    const paths = container.querySelectorAll('path');
    expect(paths[0]).toHaveAttribute('stroke-width', '3');
    expect(paths[1]).toHaveAttribute('stroke-width', '3');
  });
});
