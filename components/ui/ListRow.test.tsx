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

  it('renders the grip as a pointer-only decoration and forwards capture pointer-down', () => {
    const onPointerDownCapture = vi.fn();
    const { container } = render(
      <ListRow grip={{ onPointerDownCapture }}>content</ListRow>
    );
    const grip = container.querySelector('.cursor-grab') as HTMLElement;
    expect(grip).not.toBeNull();
    // Hidden from AT and out of the tab order — it has no keyboard behavior;
    // the kebab's surface is the accessible management path.
    expect(grip).toHaveAttribute('aria-hidden', 'true');
    expect(grip).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onPointerDownCapture).toHaveBeenCalledTimes(1);
  });

  it('renders the kebab after the grip and calls onOpen on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const { container } = render(
      <ListRow
        grip={{ onPointerDownCapture: () => {} }}
        menu={{ ariaLabel: 'Options for Milk', onOpen, hasPopup: 'dialog' }}
      >
        content
      </ListRow>
    );
    const grip = container.querySelector('.cursor-grab') as HTMLElement;
    const kebab = screen.getByRole('button', { name: 'Options for Milk' });
    expect(grip.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kebab).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(kebab);
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
