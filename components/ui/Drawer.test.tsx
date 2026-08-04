import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from './Drawer';

// Mock AnimatePresence to render children immediately
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, onClick, ...props }: { children: React.ReactNode, className?: string, onClick?: () => void, [key: string]: unknown }) => (
      <div className={className} onClick={onClick} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDragControls: () => ({ start: () => {} }),
}));

describe('Drawer', () => {
  const onCloseMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <Drawer isOpen={false} onClose={onCloseMock}>
        <div>Drawer Content</div>
      </Drawer>
    );
    expect(screen.queryByText('Drawer Content')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Drawer Content</div>
      </Drawer>
    );
    expect(screen.getByText('Drawer Content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} title="Test Title">
        <div>Drawer Content</div>
      </Drawer>
    );
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} title="Accessible Drawer">
        <div>Content</div>
      </Drawer>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Check that aria-labelledby is set and points to the title element
    const ariaLabelledBy = dialog.getAttribute('aria-labelledby');
    expect(ariaLabelledBy).toBeTruthy();
    const titleElement = document.getElementById(ariaLabelledBy!);
    expect(titleElement).toHaveTextContent('Accessible Drawer');

    // Backdrop should be hidden from screen readers
    const backdrop = screen.getByTestId('drawer-backdrop');
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
  });

  it('closes when clicking the backdrop', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );

    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('closes when pressing Escape key', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('Escape only closes the topmost drawer when drawers are nested', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    // The inner drawer opens AFTER the outer is already up (the real flow:
    // e.g. the habit picker opened from within the review drawer) — the stack
    // is ordered by open time, so the later-opened sheet owns Escape.
    const ui = (outerOpen: boolean, innerOpen: boolean) => (
      <Drawer isOpen={outerOpen} onClose={onCloseOuter}>
        <div>Outer</div>
        <Drawer isOpen={innerOpen} onClose={onCloseInner}>
          <div>Inner</div>
        </Drawer>
      </Drawer>
    );
    const { rerender } = render(ui(true, false));
    rerender(ui(true, true));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();

    // Close inner-then-outer so the body scroll-lock unwinds in stack order
    // and doesn't leak 'hidden' into the next test.
    rerender(ui(true, false));
    rerender(ui(false, false));
    expect(document.body.style.overflow).toBe('');
  });

  it('does not close when pressing other keys', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('locks body scroll when open', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Drawer isOpen={false} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('restores a pre-existing inline overflow value on close', () => {
    document.body.style.overflow = 'scroll';
    const { rerender } = render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Drawer isOpen={false} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('leaves no stale inline overflow when the body had none before opening', () => {
    document.body.style.removeProperty('overflow');
    const { rerender } = render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    rerender(
      <Drawer isOpen={false} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    // Must restore to the empty INLINE style, not write back a computed default.
    expect(document.body.getAttribute('style') ?? '').not.toContain('overflow');
  });

  it('does not close when disableClose is true', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} disableClose={true}>
        <div>Content</div>
      </Drawer>
    );

    // Try clicking backdrop
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onCloseMock).not.toHaveBeenCalled();

    // Try pressing Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('supports custom aria-label when no title is provided', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} ariaLabel="Custom Label">
        <div>Content</div>
      </Drawer>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-label', 'Custom Label');
    expect(dialog).not.toHaveAttribute('aria-labelledby');
  });

  it('supports custom ariaLabelledBy', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} ariaLabelledBy="custom-id">
        <div id="custom-id">Custom Title</div>
      </Drawer>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', 'custom-id');
  });

  it('sizes to content by default (no fixed-height detent class)', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock}>
        <div>Content</div>
      </Drawer>
    );
    const content = screen.getByTestId('drawer-content');
    expect(content.className).toContain('max-h-[90vh]');
    // The fixed-height detent variant should be absent in the default 'auto' mode.
    expect(content.className).not.toContain('supports-[height:100dvh]:h-[90dvh]');
  });

  it('applies a fixed tall detent when height="tall"', () => {
    render(
      <Drawer isOpen={true} onClose={onCloseMock} height="tall">
        <div>Content</div>
      </Drawer>
    );
    const content = screen.getByTestId('drawer-content');
    expect(content.className).toContain('supports-[height:100dvh]:h-[90dvh]');
  });

  // The REAL Drawer and the REAL useFocusTrap, deliberately: the defect these
  // pin (two stacked sheets fighting over Tab) is invisible to any suite that
  // mocks `Drawer` away to a passthrough <div>, which is exactly how it reached
  // main. `SafeToSpendBreakdownDrawer` → `RebalanceBucketsDrawer` is the real
  // pairing; this reproduces its SHAPE with plain sheets so the assertion is
  // about focus, not about budgets.
  describe('Tab focus trap with nested drawers', () => {
    // jsdom performs no layout, so `getClientRects()` is empty for every
    // element and `useFocusTrap`'s visibility filter would discard the whole
    // trap. Report a box for attached elements so the hook sees the same
    // focusables a browser would.
    beforeEach(() => {
      vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (
        this: Element
      ) {
        return (this.isConnected
          ? [{ width: 10, height: 10 }]
          : []) as unknown as DOMRectList;
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const nested = (outerOpen: boolean, innerOpen: boolean) => (
      <Drawer isOpen={outerOpen} onClose={() => {}} title="Outer">
        <button type="button">Outer action</button>
        <Drawer isOpen={innerOpen} onClose={() => {}} title="Inner">
          <button type="button">Inner first</button>
          <button type="button">Inner last</button>
        </Drawer>
      </Drawer>
    );

    /** The inner sheet's tabbables, in DOM order. */
    const innerControls = () => {
      const close = screen.getAllByLabelText('Close drawer')[1] as HTMLElement;
      return {
        close,
        first: screen.getByRole('button', { name: 'Inner first' }),
        last: screen.getByRole('button', { name: 'Inner last' }),
      };
    };

    const openNested = () => {
      const { rerender } = render(nested(true, false));
      // The inner sheet opens AFTER the outer, as it does in the app — the
      // stack is ordered by open time.
      rerender(nested(true, true));
      return { rerender };
    };

    it('lets Tab move forward through the TOP sheet while a sheet is open beneath it', async () => {
      const user = userEvent.setup();
      openNested();
      const { first, last } = innerControls();

      first.focus();
      await user.tab();

      // Before the stack-aware gate, the outer sheet's still-registered handler
      // saw focus outside its own container, called preventDefault() and pulled
      // focus back — so Tab moved nowhere at all.
      expect(document.activeElement).toBe(last);
    });

    it('lets Shift+Tab move backward through the TOP sheet too', async () => {
      const user = userEvent.setup();
      openNested();
      const { first, last } = innerControls();

      last.focus();
      await user.tab({ shift: true });

      expect(document.activeElement).toBe(first);
    });

    it('still wraps at the TOP sheet’s edges rather than escaping into the sheet below', async () => {
      const user = userEvent.setup();
      openNested();
      const { close, first, last } = innerControls();

      last.focus();
      await user.tab();
      expect(document.activeElement).toBe(close);

      await user.tab({ shift: true });
      expect(document.activeElement).toBe(last);

      // …and never lands on the outer sheet's controls.
      first.focus();
      await user.tab();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Outer action' })).not.toHaveFocus();
    });

    it('hands the trap back to the sheet below once the top one closes', async () => {
      const user = userEvent.setup();
      const { rerender } = openNested();
      rerender(nested(true, false));

      const outerAction = screen.getByRole('button', { name: 'Outer action' });
      const outerClose = screen.getByLabelText('Close drawer');

      outerAction.focus();
      await user.tab();
      // Only two tabbables left (close + action), so Tab off the last wraps.
      expect(document.activeElement).toBe(outerClose);
    });

    it('traps a single, unstacked drawer exactly as before', async () => {
      const user = userEvent.setup();
      render(
        <Drawer isOpen={true} onClose={() => {}} title="Solo">
          <button type="button">Solo action</button>
        </Drawer>
      );

      const action = screen.getByRole('button', { name: 'Solo action' });
      const close = screen.getByLabelText('Close drawer');

      action.focus();
      await user.tab();
      expect(document.activeElement).toBe(close);
    });
  });
});
