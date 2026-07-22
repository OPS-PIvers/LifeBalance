import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReviewQueueCard } from './ReviewQueueCard';

describe('ReviewQueueCard', () => {
  it('renders nothing when the count is zero', () => {
    const onOpen = vi.fn();
    const { container } = render(<ReviewQueueCard count={0} onOpen={onOpen} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the singular label for exactly one item', () => {
    render(<ReviewQueueCard count={1} onOpen={vi.fn()} />);
    expect(screen.getByText('1 item to review')).toBeInTheDocument();
    expect(screen.getByText('Added via Quick Add — tap to approve')).toBeInTheDocument();
  });

  it('shows the plural label and count for multiple items', () => {
    render(<ReviewQueueCard count={4} onOpen={vi.fn()} />);
    expect(screen.getByText('4 items to review')).toBeInTheDocument();
  });

  it('calls onOpen when tapped', () => {
    const onOpen = vi.fn();
    render(<ReviewQueueCard count={2} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('2 items to review'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
