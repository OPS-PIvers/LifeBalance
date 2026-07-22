import { Drawer, Button, Input } from 'lifebalance';

export const AddExpense = () => (
  <Drawer
    isOpen
    onClose={() => {}}
    title="Add expense"
    footer={
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" className="flex-1">Cancel</Button>
        <Button variant="primary" className="flex-1">Save</Button>
      </div>
    }
  >
    <div style={{ display: 'grid', gap: 16 }}>
      <Input label="Merchant" defaultValue="Trader Joe's" />
      <Input label="Amount" defaultValue="42.80" inputMode="decimal" />
    </div>
  </Drawer>
);
