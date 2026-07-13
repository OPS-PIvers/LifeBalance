import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ListRow } from './ListRow';

describe('ListRow', () => {
  it('renders leading control, content, and accessories', () => {
    render(
      <ListRow leading={<span>toggle</span>} accessories={<span>star</span>}>
        <span>content</span>
      </ListRow>
    );
    expect(screen.getByText('toggle')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getByText('star')).toBeInTheDocument();
  });

  it('renders no right rail when neither grip nor menu is provided', () => {
    render(<ListRow>content</ListRow>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the grip with its accessible name and forwards capture pointer-down', () => {
    const onPointerDownCapture = vi.fn();
    render(
      <ListRow grip={{ ariaLabel: 'Drag to reorder Milk', onPointerDownCapture }}>
        content
      </ListRow>
    );
    const grip = screen.getByRole('button', { name: 'Drag to reorder Milk' });
    expect(grip).toHaveAttribute('tabindex', '0');
    // fireEvent.pointerDown routes through the capture handler on the grip itself.
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onPointerDownCapture).toHaveBeenCalledTimes(1);
  });

  it('renders the kebab after the grip and calls onOpen on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <ListRow
        grip={{ ariaLabel: 'Drag to reorder Milk', onPointerDownCapture: () => {} }}
        menu={{ ariaLabel: 'Options for Milk', onOpen, hasPopup: 'dialog' }}
      >
        content
      </ListRow>
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Drag to reorder Milk');
    expect(buttons[1]).toHaveAccessibleName('Options for Milk');
    expect(buttons[1]).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(buttons[1] as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('defaults the kebab popup type to menu and reflects expanded state', () => {
    render(
      <ListRow menu={{ ariaLabel: 'Options', onOpen: () => {}, expanded: true }}>
        content
      </ListRow>
    );
    const kebab = screen.getByRole('button', { name: 'Options' });
    expect(kebab).toHaveAttribute('aria-haspopup', 'menu');
    expect(kebab).toHaveAttribute('aria-expanded', 'true');
  });

  it('spreads container props and merges className', () => {
    const onClick = vi.fn();
    const { container } = render(
      <ListRow className="bg-white" data-testid="row" onClick={onClick}>
        content
      </ListRow>
    );
    const row = container.firstChild as HTMLElement;
    expect(row).toHaveAttribute('data-testid', 'row');
    expect(row).toHaveClass('bg-white', 'flex', 'items-center');
  });
});
