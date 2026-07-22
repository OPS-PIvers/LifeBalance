import { ListRow, Badge } from 'lifebalance';

const Check = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
);

const Circle = ({ done }: { done?: boolean }) => (
  <span
    style={{
      width: 22, height: 22, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: '2px solid var(--color-brand-300, #cfc9bb)',
      background: done ? 'var(--color-accent-600, #2f6f4f)' : 'transparent',
      color: '#fff', flexShrink: 0,
    }}
  >
    {done && <Check />}
  </span>
);

export const Rows = () => (
  <div style={{ width: 340, border: '1px solid var(--color-brand-200, #e6e1d6)', borderRadius: 12, overflow: 'hidden', background: 'var(--color-white, #fff)' }}>
    <ListRow leading={<Circle done />} menu={{ ariaLabel: 'Options for Oat milk', onOpen: () => {} }}>
      <span style={{ textDecoration: 'line-through', color: 'var(--color-brand-400, #a49e90)' }}>Oat milk</span>
    </ListRow>
    <ListRow leading={<Circle />} accessories={<Badge variant="warning" size="sm">2</Badge>} menu={{ ariaLabel: 'Options for Eggs', onOpen: () => {} }}>
      Eggs
    </ListRow>
    <ListRow leading={<Circle />} menu={{ ariaLabel: 'Options for Sourdough', onOpen: () => {} }}>
      Sourdough loaf
    </ListRow>
  </div>
);
