import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
