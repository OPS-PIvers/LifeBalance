import { ProgressBar } from 'lifebalance';

const track = 'bg-brand-100 dark:bg-brand-700 h-2';

const Line = ({ label, value, bar }: { label: string; value: number; bar: string }) => (
  <div style={{ display: 'grid', gap: 6 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span style={{ color: 'var(--color-brand-500, #8a8579)' }}>{value}%</span>
    </div>
    <ProgressBar value={value} className={track} barClassName={bar} ariaLabel={label} />
  </div>
);

export const Buckets = () => (
  <div style={{ display: 'grid', gap: 16, width: 300 }}>
    <Line label="Groceries" value={45} bar="bg-accent-600 dark:bg-accent-400" />
    <Line label="Dining out" value={82} bar="bg-warm-500" />
    <Line label="Shopping" value={112} bar="bg-money-neg" />
  </div>
);
