import { PageHeader, Button } from 'lifebalance';

const Plus = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

export const Default = () => (
  <div style={{ width: 380, background: 'var(--color-brand-50, #f7f5ef)', borderRadius: 12 }}>
    <PageHeader title="Habits" subtitle="4 of 6 done today · 210 pts" />
  </div>
);

export const WithActions = () => (
  <div style={{ width: 380, background: 'var(--color-brand-50, #f7f5ef)', borderRadius: 12 }}>
    <PageHeader
      title="Money"
      subtitle="$412.60 safe to spend"
      actions={<Button variant="subtle" size="sm" leftIcon={<Plus />}>Add</Button>}
    />
  </div>
);

export const Nested = () => (
  <div style={{ width: 380, background: 'var(--color-brand-50, #f7f5ef)', borderRadius: 12 }}>
    <PageHeader as="h2" title="Shopping" subtitle="12 items · 2 stores" />
  </div>
);
