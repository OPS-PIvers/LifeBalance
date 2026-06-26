import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

describe('SegmentedControl', () => {
  const options = [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2', activeClassName: 'text-red-500' },
  ];

  it('renders options correctly', () => {
    render(<SegmentedControl options={options} value="opt1" onChange={() => {}} />);
    expect(screen.getByText('Option 1')).toBeInTheDocument();
    expect(screen.getByText('Option 2')).toBeInTheDocument();
  });

  it('indicates selected option with role="radio" + aria-checked', () => {
    render(<SegmentedControl options={options} value="opt1" onChange={() => {}} />);
    const btn1 = screen.getByRole('radio', { name: /option 1/i });
    const btn2 = screen.getByRole('radio', { name: /option 2/i });

    expect(btn1).toHaveAttribute('aria-checked', 'true');
    expect(btn2).toHaveAttribute('aria-checked', 'false');
  });

  it('uses roving tabIndex (only the active option is tabbable)', () => {
    render(<SegmentedControl options={options} value="opt1" onChange={() => {}} />);
    const btn1 = screen.getByRole('radio', { name: /option 1/i });
    const btn2 = screen.getByRole('radio', { name: /option 2/i });

    expect(btn1).toHaveAttribute('tabindex', '0');
    expect(btn2).toHaveAttribute('tabindex', '-1');
  });

  it('calls onChange when clicked', () => {
    const handleChange = vi.fn();
    render(<SegmentedControl options={options} value="opt1" onChange={handleChange} />);

    fireEvent.click(screen.getByText('Option 2'));
    expect(handleChange).toHaveBeenCalledWith('opt2');
  });

  it('moves selection with arrow keys', () => {
    const handleChange = vi.fn();
    render(<SegmentedControl options={options} value="opt1" onChange={handleChange} />);

    const btn1 = screen.getByRole('radio', { name: /option 1/i });
    fireEvent.keyDown(btn1, { key: 'ArrowRight' });
    expect(handleChange).toHaveBeenCalledWith('opt2');

    fireEvent.keyDown(btn1, { key: 'ArrowLeft' });
    expect(handleChange).toHaveBeenCalledWith('opt2'); // wraps back around
  });

  it('applies activeClassName to selected option', () => {
    render(<SegmentedControl options={options} value="opt2" onChange={() => {}} />);
    const btn2 = screen.getByRole('radio', { name: /option 2/i });

    expect(btn2).toHaveClass('text-red-500');
  });

  it('applies radiogroup role and name', () => {
    render(<SegmentedControl options={options} value="opt1" onChange={() => {}} name="My Group" />);
    const group = screen.getByRole('radiogroup', { name: /my group/i });
    expect(group).toBeInTheDocument();
  });

  it('conditionally applies border based on showBorder prop', () => {
    const { rerender } = render(
      <SegmentedControl options={options} value="opt1" onChange={() => {}} showBorder={true} name="Border Group" />
    );
    let group = screen.getByRole('radiogroup', { name: /border group/i });
    expect(group).toHaveClass('border');

    rerender(
      <SegmentedControl options={options} value="opt1" onChange={() => {}} showBorder={false} name="Border Group" />
    );
    group = screen.getByRole('radiogroup', { name: /border group/i });
    expect(group).not.toHaveClass('border');
  });
});
