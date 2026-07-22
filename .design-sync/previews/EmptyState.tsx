import { EmptyState, Button } from 'lifebalance';

const Svg = ({ children, size = 24 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const Receipt = () => <Svg><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z" /><path d="M8 7h8M8 11h8M8 15h5" /></Svg>;
const ListChecks = () => <Svg><path d="M3 6l2 2 3-3M3 14l2 2 3-3M11 6h10M11 15h10" /></Svg>;
const AlertCircle = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Svg>;

export const FirstRun = () => (
  <div style={{ width: 360 }}>
    <EmptyState
      variant="surface"
      icon={<Receipt />}
      title="No transactions yet"
      description="Add your first expense to start tracking Safe-to-Spend."
      action={<Button variant="primary">Add expense</Button>}
    />
  </div>
);

export const Compact = () => (
  <div style={{ width: 340 }}>
    <EmptyState
      size="compact"
      icon={<ListChecks />}
      title="All caught up"
      description="No to-dos due today."
    />
  </div>
);

export const Dashed = () => (
  <div style={{ width: 340 }}>
    <EmptyState
      variant="dashed"
      icon={<ListChecks />}
      title="Nothing planned"
      description="Tap to plan a meal for tonight."
    />
  </div>
);

export const Danger = () => (
  <div style={{ width: 340 }}>
    <EmptyState
      tone="danger"
      icon={<AlertCircle />}
      title="Couldn’t sync your bank"
      description="We’ll retry automatically. Check your connection."
      action={<Button variant="secondary">Retry now</Button>}
    />
  </div>
);
