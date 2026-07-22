import { Select } from 'lifebalance';

const Wallet = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 12V8H6a2 2 0 010-4h12v4" /><path d="M4 6v12a2 2 0 002 2h14v-4" /><path d="M18 12a2 2 0 000 4h4v-4z" />
  </svg>
);

const col: React.CSSProperties = { display: 'grid', gap: 16, maxWidth: 320 };

export const WithLabel = () => (
  <div style={col}>
    <Select label="Category" defaultValue="groceries">
      <option value="groceries">Groceries</option>
      <option value="dining">Dining out</option>
      <option value="transport">Transport</option>
      <option value="utilities">Utilities</option>
    </Select>
  </div>
);

export const WithIcon = () => (
  <div style={col}>
    <Select label="Account" icon={<Wallet />} defaultValue="checking">
      <option value="checking">Joint Checking</option>
      <option value="savings">Emergency Savings</option>
      <option value="credit">Visa ••6411</option>
    </Select>
  </div>
);

export const Error = () => (
  <div style={col}>
    <Select label="Pay period" error="Select a pay period" defaultValue="">
      <option value="" disabled>Choose one…</option>
      <option value="cur">Jul 15 – Jul 29</option>
      <option value="next">Jul 29 – Aug 12</option>
    </Select>
  </div>
);
