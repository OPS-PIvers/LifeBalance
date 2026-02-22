import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tag } from './Tag';
import React from 'react';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="x-icon" />,
}));

describe('Tag Component', () => {
  it('renders label correctly', () => {
    render(<Tag label="Test Tag" />);
    expect(screen.getByText('Test Tag')).toBeInTheDocument();
  });

  it('handles split button behavior (click and remove)', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    render(<Tag label="Split Tag" onClick={onClick} onRemove={onRemove} />);

    // Check rendering
    expect(screen.getByText('Split Tag')).toBeInTheDocument();
    expect(screen.getByTestId('x-icon')).toBeInTheDocument();

    // Click label part
    fireEvent.click(screen.getByText('Split Tag'));
    expect(onClick).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    // Click remove part
    const removeBtn = screen.getByTestId('x-icon').closest('button');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn!);
    expect(onRemove).toHaveBeenCalled();
  });

  it('handles clickable only behavior', () => {
    const onClick = vi.fn();
    render(<Tag label="Click Tag" onClick={onClick} />);

    // Click the whole tag
    fireEvent.click(screen.getByText('Click Tag'));
    expect(onClick).toHaveBeenCalled();
  });

  it('handles removable only behavior', () => {
    const onRemove = vi.fn();
    render(<Tag label="Remove Tag" onRemove={onRemove} />);

    // Click remove button
    const removeBtn = screen.getByTestId('x-icon').closest('button');
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn!);
    expect(onRemove).toHaveBeenCalled();
  });

  it('applies variants correctly', () => {
    const { container } = render(<Tag label="Brand Tag" variant="brand" />);
    // Check for brand classes. Note: Tag renders different root elements based on props.
    // For label-only, it renders a span.
    const tag = container.firstChild as HTMLElement;
    expect(tag).toHaveClass('bg-brand-100');
  });

  it('applies custom className', () => {
    const { container } = render(<Tag label="Custom Tag" className="bg-red-500" />);
    expect(container.firstChild).toHaveClass('bg-red-500');
  });
});
