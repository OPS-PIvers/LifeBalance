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
  /** Name of the item being deleted (e.g. "task", "calendar item"). */
  itemName: string;
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
