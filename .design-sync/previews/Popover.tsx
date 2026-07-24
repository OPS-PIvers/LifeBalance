import { Popover, Eyebrow, Switch, Button } from 'lifebalance';

// Popover is NOT portalled — it positions itself inside the nearest positioned
// ancestor, so render it as a sibling of its trigger in a `relative` wrapper.
const Anchor = ({ children, height = 230 }: { children: React.ReactNode; height?: number }) => (
  <div style={{ position: 'relative', width: 280, height }}>{children}</div>
);

const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 12, padding: '8px 0', fontSize: 14, color: 'var(--color-brand-700, #4a4539)',
};

export const FilterPanel = () => (
  <Anchor>
    <Popover isOpen onClose={() => {}} role="dialog" ariaLabel="Filter transactions" position="top-0 left-0" className="w-64 p-4">
      <Eyebrow>Filter</Eyebrow>
      <div style={{ marginTop: 8 }}>
        <div style={row}>
          <span>Needs review only</span>
          <Switch checked onCheckedChange={() => {}} aria-label="Needs review only" />
        </div>
        <div style={row}>
          <span>Hide transfers</span>
          <Switch checked={false} onCheckedChange={() => {}} aria-label="Hide transfers" />
        </div>
      </div>
      <Button variant="secondary" size="sm" className="mt-2 w-full">Reset</Button>
    </Popover>
  </Anchor>
);

export const Unstyled = () => (
  <Anchor height={140}>
    <Popover
      isOpen
      onClose={() => {}}
      role="dialog"
      ariaLabel="Streak tip"
      position="top-0 left-0"
      unstyled
      className="w-60 rounded-card bg-brand-900 px-3 py-2 text-xs text-brand-50"
    >
      A freeze bridges one missed day without breaking your streak — you have 2 left this month.
    </Popover>
  </Anchor>
);
