import { ConfirmDialog } from 'lifebalance';

export const Destructive = () => (
  <ConfirmDialog
    isOpen
    onClose={() => {}}
    onConfirm={() => {}}
    title="Delete this transaction?"
    message="Trader Joe's — $62.14 on Jul 21. This also removes it from the Groceries bucket."
    confirmLabel="Delete"
  />
);

export const Confirming = () => (
  <ConfirmDialog
    isOpen
    onClose={() => {}}
    onConfirm={() => {}}
    title="Reset this habit?"
    message="Make your bed loses today's completion and its 12-day streak."
    confirmLabel="Reset habit"
    isConfirming
  />
);

export const Primary = () => (
  <ConfirmDialog
    isOpen
    onClose={() => {}}
    onConfirm={() => {}}
    title="Approve this paycheck?"
    message="$1,842.00 lands in Joint Checking and starts a new pay period."
    confirmLabel="Approve"
    cancelLabel="Not yet"
    confirmVariant="primary"
  />
);
