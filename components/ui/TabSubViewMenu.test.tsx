import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TabSubViewMenu } from './TabSubViewMenu';
import { tabValueAtPoint } from './tabValueAtPoint';

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

describe('tabValueAtPoint', () => {
  /** Build a tab-bar container whose triggers report the given viewport rects
   *  (jsdom's own getBoundingClientRect always returns zeros). */
  const buildTabBar = (rects: Record<string, { left: number; right: number }>) => {
    const container = document.createElement('div');
    for (const [value, { left, right }] of Object.entries(rects)) {
      const trigger = document.createElement('button');
      trigger.setAttribute('data-tabs-value', value);
      trigger.getBoundingClientRect = () =>
        ({ left, right, top: 100, bottom: 144, width: right - left, height: 44, x: left, y: 100, toJSON: () => ({}) }) as DOMRect;
      container.appendChild(trigger);
    }
    return container;
  };

  const tabBar = () =>
    buildTabBar({
      track: { left: 0, right: 100 },
      progress: { left: 100, right: 200 },
      rewards: { left: 200, right: 300 },
    });

  it('returns the value of the trigger under the point', () => {
    expect(tabValueAtPoint(tabBar(), 50, 120)).toBe('track');
    expect(tabValueAtPoint(tabBar(), 150, 120)).toBe('progress');
    expect(tabValueAtPoint(tabBar(), 250, 120)).toBe('rewards');
  });

  it('returns null for points outside every trigger', () => {
    expect(tabValueAtPoint(tabBar(), 150, 50)).toBeNull(); // above the bar
    expect(tabValueAtPoint(tabBar(), 150, 200)).toBeNull(); // below the bar
    expect(tabValueAtPoint(tabBar(), 350, 120)).toBeNull(); // right of the bar
  });

  it('returns null for a null container', () => {
    expect(tabValueAtPoint(null, 50, 120)).toBeNull();
  });
});
