import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, type MenuItem } from './Menu';

describe('Menu', () => {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  const onDisabled = vi.fn();

  const items: MenuItem[] = [
    { key: 'edit', label: 'Edit', onSelect: onEdit },
    { key: 'disabled', label: 'Disabled action', onSelect: onDisabled, disabled: true },
    { key: 'delete', label: 'Delete', onSelect: onDelete, tone: 'danger' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderMenu = (open = true) =>
    render(<Menu isOpen={open} onClose={onClose} items={items} ariaLabel="Test actions" />);

  it('renders nothing when closed', () => {
    renderMenu(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('renders a labelled menu with all items when open', () => {
    renderMenu();
    expect(screen.getByRole('menu', { name: 'Test actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('activates an item: calls onSelect then closes', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not activate a disabled item', async () => {
    const user = userEvent.setup();
    renderMenu();
    const disabled = screen.getByText('Disabled action').closest('button')!;
    expect(disabled).toBeDisabled();
    await user.click(disabled);
    expect(onDisabled).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    renderMenu();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderMenu();
    // The transparent click-away backdrop is the full-screen fixed sibling.
    const backdrop = container.querySelector('.fixed.inset-0')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('roves focus across enabled items with ArrowDown, skipping disabled ones', () => {
    renderMenu();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByText('Edit').closest('button'));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    // Skips the disabled item and lands on Delete.
    expect(document.activeElement).toBe(screen.getByText('Delete').closest('button'));
  });
});
