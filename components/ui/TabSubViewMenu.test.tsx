import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabSubViewMenu } from './TabSubViewMenu';

const OPTIONS = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'trends', label: 'Trends' },
] as const;

type OptionValue = (typeof OPTIONS)[number]['value'];

/** Harness mirroring the pages' shape: a relative tab-bar container holding a
 *  `[data-tabs-value]` trigger and the menu anchored inside it. */
const Harness: React.FC<{
  isOpen?: boolean;
  value?: OptionValue;
  options?: readonly { value: OptionValue; label: string }[];
  onClose?: () => void;
  onSelect?: (value: OptionValue) => void;
}> = ({ isOpen = true, value = 'transactions', options = OPTIONS, onClose = () => {}, onSelect = () => {} }) => {
  const anchorRef = React.useRef<HTMLDivElement>(null);
  return (
    <div className="relative" ref={anchorRef}>
      <button type="button" data-tabs-value="activity">
        Activity
      </button>
      <TabSubViewMenu
        isOpen={isOpen}
        onClose={onClose}
        options={[...options]}
        value={value}
        onSelect={onSelect}
        name="Activity view"
        anchorValue="activity"
        anchorRef={anchorRef}
      />
    </div>
  );
};

describe('TabSubViewMenu', () => {
  it('renders a named menu of menuitemradio options when open', () => {
    render(<Harness />);

    const menu = screen.getByRole('menu', { name: 'Activity view' });
    expect(menu).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((el) => el.textContent)).toEqual(['Transactions', 'Trends']);
  });

  it('renders nothing when closed', () => {
    render(<Harness isOpen={false} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders nothing for fewer than two options', () => {
    render(<Harness options={[{ value: 'transactions', label: 'Transactions' }]} />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('checks only the current sub-view and marks it for initial focus', () => {
    render(<Harness value="trends" />);

    const current = screen.getByRole('menuitemradio', { name: 'Trends' });
    const other = screen.getByRole('menuitemradio', { name: 'Transactions' });
    expect(current).toHaveAttribute('aria-checked', 'true');
    expect(other).toHaveAttribute('aria-checked', 'false');
    // The checkmark lives on the checked row only.
    expect(current.querySelector('svg')).not.toBeNull();
    expect(other.querySelector('svg')).toBeNull();
    // useFocusTrap prefers [data-autofocus] — initial focus lands on the
    // checked item.
    expect(current).toHaveFocus();
  });

  it('selecting an option fires onSelect with its value and closes first', () => {
    const calls: string[] = [];
    const onClose = vi.fn(() => calls.push('close'));
    const onSelect = vi.fn((v: OptionValue) => calls.push(`select:${v}`));
    render(<Harness onClose={onClose} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Trends' }));

    expect(onSelect).toHaveBeenCalledWith('trends');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['close', 'select:trends']);
  });

  it('Escape closes without selecting', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onClose={onClose} onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('outside tap (backdrop) closes without selecting', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<Harness onClose={onClose} onSelect={onSelect} />);

    // Popover's transparent click-away backdrop is the aria-hidden fixed layer.
    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('row highlight is gated on focus-visible, not plain focus (touch-open shows only the checkmark)', () => {
    render(<Harness value="trends" />);

    // Initial focus lands programmatically on the checked row; after a touch
    // open that focus is NOT :focus-visible, so the background must be bound
    // to the focus-visible variant — a plain focus:bg- would paint the row the
    // moment the menu opens and read as a stuck pre-selection.
    for (const item of screen.getAllByRole('menuitemradio')) {
      expect(item.className).toContain('focus-visible:bg-');
      expect(item.className).not.toMatch(/(?:^|\s)focus:bg-/);
    }
  });

  it('ArrowDown moves focus to the next option', () => {
    render(<Harness />);

    const menu = screen.getByRole('menu', { name: 'Activity view' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });

    expect(screen.getByRole('menuitemradio', { name: 'Trends' })).toHaveFocus();
  });
});
