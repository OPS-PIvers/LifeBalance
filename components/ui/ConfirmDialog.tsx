import React, { useId } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  isOpen: boolean;
  /** Called when the user cancels or dismisses the dialog (Escape / backdrop / Cancel). */
  onClose: () => void;
  /** Called when the user confirms the action. */
  onConfirm: () => void;
  title: string;
  /** Body text or rich content describing what is being confirmed. */
  message: React.ReactNode;
  /** Label for the confirm button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Visual emphasis of the confirm button. Defaults to "destructive". */
  confirmVariant?: React.ComponentProps<typeof Button>['variant'];
  /** Shows a spinner / disables the confirm button while an async action runs. */
  isConfirming?: boolean;
}

/**
 * Accessible replacement for `window.confirm`.
 *
 * Built on the standard Modal primitive (focus trap, Escape handling, scroll
 * lock, `role="dialog"` + `aria-modal`). The title and message are wired via
 * `aria-labelledby` / `aria-describedby` so screen readers announce the dialog
 * and its question. Unlike `window.confirm`, this is styled, dark-mode aware,
 * keyboard accessible, and restores focus to the trigger on close.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  isConfirming = false,
}) => {
  const titleId = useId();
  const descId = useId();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-sm"
      ariaLabelledBy={titleId}
      ariaDescribedBy={descId}
      className="dark:bg-slate-900"
      disableBackdropClose={isConfirming}
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        <div id={descId} className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {message}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isConfirming}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} isLoading={isConfirming}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
