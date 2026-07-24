import { CompactSelect } from 'lifebalance';

const BUCKETS = [
  { id: 'groceries', label: 'Groceries' },
  { id: 'dining', label: 'Dining out' },
  { id: 'gas', label: 'Gas & transit' },
  { id: 'home', label: 'Home' },
];

const merchant: React.CSSProperties = { fontSize: 14, color: 'var(--color-brand-800, #332f2a)' };
const amount: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--color-money-neg, #a8392c)',
};

export const Categorized = () => (
  <div style={{ display: 'grid', gap: 6, width: 260 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={merchant}>Trader Joe&apos;s</span>
      <span style={amount}>−$62.14</span>
    </div>
    <CompactSelect
      value="groceries"
      onChange={() => {}}
      options={BUCKETS}
      placeholder="Choose bucket"
      aria-label="Budget bucket for Trader Joe's"
    />
  </div>
);

export const Uncategorized = () => (
  <div style={{ display: 'grid', gap: 6, width: 260 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={merchant}>SQ *BLUE DOOR</span>
      <span style={amount}>−$18.75</span>
    </div>
    <CompactSelect
      value=""
      onChange={() => {}}
      options={BUCKETS}
      placeholder="Choose bucket"
      aria-label="Budget bucket for SQ *BLUE DOOR"
    />
  </div>
);
