import { Modal, Button } from 'lifebalance';

export const Confirm = () => (
  <Modal isOpen onClose={() => {}} maxWidth="max-w-sm">
    <div style={{ padding: 24, textAlign: 'center' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Approve paycheck?</h2>
      <p style={{ marginTop: 8, color: 'var(--color-brand-500, #8a8579)', fontSize: 14 }}>
        $3,100 will be added to Joint Checking and this pay period will roll over.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <Button variant="secondary" className="flex-1">Not yet</Button>
        <Button variant="success" className="flex-1">Approve</Button>
      </div>
    </div>
  </Modal>
);
