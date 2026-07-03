import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ShowMoreRow } from './ShowMoreRow';

describe('ShowMoreRow', () => {
  it('renders "+ N more items" with the default noun while collapsed', () => {
    render(<ShowMoreRow hiddenCount={3} expanded={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: '+ 3 more items' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('pluralizes a custom noun', () => {
    render(<ShowMoreRow hiddenCount={2} expanded={false} onToggle={() => {}} noun="task" />);
    expect(screen.getByRole('button', { name: '+ 2 more tasks' })).toBeInTheDocument();
  });

  it('uses the singular noun when exactly one item is hidden', () => {
    render(<ShowMoreRow hiddenCount={1} expanded={false} onToggle={() => {}} noun="habit" />);
    expect(screen.getByRole('button', { name: '+ 1 more habit' })).toBeInTheDocument();
  });

  it('fires onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ShowMoreRow hiddenCount={5} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: '+ 5 more items' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders nothing at hiddenCount 0 while collapsed', () => {
    const { container } = render(
      <ShowMoreRow hiddenCount={0} expanded={false} onToggle={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a negative hiddenCount while collapsed', () => {
    const { container } = render(
      <ShowMoreRow hiddenCount={-2} expanded={false} onToggle={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the collapse label with aria-expanded true when expanded, even at hiddenCount 0', () => {
    const onToggle = vi.fn();
    render(<ShowMoreRow hiddenCount={0} expanded onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Show fewer' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('supports a custom collapse label', () => {
    render(
      <ShowMoreRow
        hiddenCount={4}
        expanded
        onToggle={() => {}}
        collapseLabel="Collapse list"
      />
    );
    expect(screen.getByRole('button', { name: 'Collapse list' })).toBeInTheDocument();
  });

  it('styles the row as a full-width hairline row', () => {
    render(<ShowMoreRow hiddenCount={2} expanded={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: '+ 2 more items' });
    expect(button).toHaveClass('hairline-divider');
    expect(button).toHaveClass('w-full');
  });
});
