import { Menu } from 'lifebalance';

const Pencil = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
);

const Snowflake = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1M2 12h20" /></svg>
);

const Trash = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
);

// Popover anchors to the nearest positioned ancestor, so a menu always lives
// in a `relative` wrapper alongside its trigger.
const Anchor = ({ children }: { children: React.ReactNode }) => (
  <div style={{ position: 'relative', width: 260, height: 210 }}>{children}</div>
);

export const HabitActions = () => (
  <Anchor>
    <Menu
      isOpen
      onClose={() => {}}
      ariaLabel="Habit actions"
      position="top-0 left-0"
      className="min-w-[208px]"
      items={[
        { key: 'edit', label: 'Edit habit', icon: <Pencil />, onSelect: () => {} },
        { key: 'freeze', label: 'Use a freeze', icon: <Snowflake />, tone: 'info', onSelect: () => {} },
        { key: 'delete', label: 'Delete habit', icon: <Trash />, tone: 'danger', onSelect: () => {} },
      ]}
    />
  </Anchor>
);

export const RadioGroup = () => (
  <Anchor>
    <Menu
      isOpen
      onClose={() => {}}
      ariaLabel="Sort to-dos"
      position="top-0 left-0"
      className="min-w-[208px]"
      items={[
        { key: 'due', label: 'Due date', selected: true, group: 'Sort by', onSelect: () => {} },
        { key: 'added', label: 'Recently added', selected: false, group: 'Sort by', onSelect: () => {} },
        { key: 'effort', label: 'Effort', selected: false, group: 'Sort by', onSelect: () => {} },
        { key: 'clear', label: 'Clear completed', tone: 'danger', onSelect: () => {} },
      ]}
    />
  </Anchor>
);

export const WithDisabled = () => (
  <Anchor>
    <Menu
      isOpen
      onClose={() => {}}
      ariaLabel="Transaction actions"
      position="top-0 left-0"
      className="min-w-[208px]"
      items={[
        { key: 'approve', label: 'Approve', tone: 'primary', onSelect: () => {} },
        { key: 'split', label: 'Split transaction', disabled: true, onSelect: () => {} },
        { key: 'delete', label: 'Delete', tone: 'danger', onSelect: () => {} },
      ]}
    />
  </Anchor>
);
