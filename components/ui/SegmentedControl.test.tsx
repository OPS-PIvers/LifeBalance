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

  it('uses evergreen accent active text by default', () => {
    const plain = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    render(<SegmentedControl options={plain} value="a" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'A' })).toHaveClass('text-accent-700');
  });

  it('uses warm active text for tone="warm"', () => {
    const plain = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    render(<SegmentedControl options={plain} value="a" onChange={() => {}} tone="warm" />);
    const active = screen.getByRole('radio', { name: 'A' });
    expect(active).toHaveClass('text-warm-700');
    expect(active).not.toHaveClass('text-accent-700');
  });

  it('lets a per-option activeClassName override the tone', () => {
    render(<SegmentedControl options={options} value="opt2" onChange={() => {}} tone="warm" />);
    const btn2 = screen.getByRole('radio', { name: /option 2/i });
    // opt2 has activeClassName="text-red-500" → it wins over the warm default
    expect(btn2).toHaveClass('text-red-500');
    expect(btn2).not.toHaveClass('text-warm-700');
  });

  it('marks the active option with data-autofocus so a Drawer/Popover focus trap lands there, not the first option', () => {
    // useFocusTrap prefers [data-autofocus] over the first focusable — a
    // control whose default value isn't the first option (e.g. Day/Week
    // defaulting to "week") must not leave initial focus on the unselected
    // first segment.
    render(<SegmentedControl options={options} value="opt2" onChange={() => {}} />);
    const btn1 = screen.getByRole('radio', { name: /option 1/i });
    const btn2 = screen.getByRole('radio', { name: /option 2/i });

    expect(btn2).toHaveAttribute('data-autofocus');
    expect(btn1).not.toHaveAttribute('data-autofocus');
  });

  it('applies radiogroup role and name', () => {
    render(<SegmentedControl options={options} value="opt1" onChange={() => {}} name="My Group" />);
    const group = screen.getByRole('radiogroup', { name: /my group/i });
    expect(group).toBeInTheDocument();
  });

  it('disables all options and blocks selection when disabled', () => {
    const handleChange = vi.fn();
    render(<SegmentedControl options={options} value="opt1" onChange={handleChange} disabled name="Disabled Group" />);
    const btn2 = screen.getByRole('radio', { name: /option 2/i });
    expect(btn2).toBeDisabled();
    fireEvent.click(btn2);
    expect(handleChange).not.toHaveBeenCalled();
    // arrow-key nav is also blocked
    fireEvent.keyDown(screen.getByRole('radio', { name: /option 1/i }), { key: 'ArrowRight' });
    expect(handleChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup', { name: /disabled group/i })).toHaveAttribute('aria-disabled', 'true');
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
