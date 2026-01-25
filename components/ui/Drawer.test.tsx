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
    expect(dialog).toHaveAttribute('aria-labelledby', 'drawer-title');

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
});
