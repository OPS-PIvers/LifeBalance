import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  const onCloseMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up body style
    document.body.style.overflow = '';
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal isOpen={false} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has correct accessibility attributes', () => {
    render(
      <Modal
        isOpen={true}
        onClose={onCloseMock}
        ariaLabelledBy="modal-title"
        ariaDescribedBy="modal-desc"
      >
        <h2 id="modal-title">Title</h2>
        <p id="modal-desc">Description</p>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'modal-desc');
  });

  it('closes when pressing Escape key', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when pressing Escape key if disableBackdropClose is true', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock} disableBackdropClose={true}>
        <div>Modal Content</div>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('closes when clicking the backdrop (wrapper)', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );

    // The backdrop wrapper handles the click and checks for target === currentTarget.
    // (role="dialog" now lives on the content container, per a11y fix, so we query the
    // wrapper by its test id instead of by role.)
    fireEvent.click(screen.getByTestId('modal-backdrop-wrapper'));
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when clicking the content', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div data-testid="content">Modal Content</div>
      </Modal>
    );

    fireEvent.click(screen.getByTestId('content'));
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('does NOT close when clicking the backdrop if disableBackdropClose is true', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock} disableBackdropClose={true}>
        <div>Modal Content</div>
      </Modal>
    );

    fireEvent.click(screen.getByTestId('modal-backdrop-wrapper'));
    expect(onCloseMock).not.toHaveBeenCalled();
  });

  it('locks body scroll when open', () => {
    render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores body scroll when closed', () => {
    const { rerender } = render(
      <Modal isOpen={true} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <Modal isOpen={false} onClose={onCloseMock}>
        <div>Modal Content</div>
      </Modal>
    );
    expect(document.body.style.overflow).toBe('');
  });
});
