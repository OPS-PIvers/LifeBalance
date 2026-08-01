/**
 * Imperative store backing the app-level delete-confirmation dialog.
 *
 * Kept separate from the {@link ConfirmDialogHost} component so the component
 * module only exports components (React Fast Refresh requirement) and the
 * imperative API can be imported by non-component callers (e.g.
 * `utils/toastHelpers`).
 */
export interface DeleteConfirmRequest {
  /** Callback to execute when the user confirms deletion. */
  onConfirm: () => void | Promise<void>;
  /** Name of the item being deleted (e.g. "task", "calendar item"). Also names
   *  the thing in the host's failure toast, so pass a correct noun even when
   *  the copy below is overridden. */
  itemName: string;
  /** Optional heading override. Absent ⇒ `Delete this {itemName}?`, which is
   *  the right question for a plain delete and the wrong one for a destructive
   *  action that isn't literally a delete (e.g. merging one row into another). */
  title?: string;
  /** Optional body override. Absent ⇒ "This action cannot be undone." Pass a
   *  body whenever the user needs to be told WHAT is removed and what survives
   *  — and don't claim irreversibility for a path that mirrors into trash. */
  message?: string;
  /** Optional confirm-button label. Absent ⇒ "Delete". */
  confirmLabel?: string;
}

type Listener = (request: DeleteConfirmRequest) => void;

const listeners = new Set<Listener>();

/** Subscribe the mounted host to incoming requests. Returns an unsubscribe fn. */
export const subscribeToDeleteConfirmations = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Push a delete-confirmation request to the mounted host. */
export const requestDeleteConfirmation = (request: DeleteConfirmRequest): void => {
  listeners.forEach((listener) => listener(request));
};
