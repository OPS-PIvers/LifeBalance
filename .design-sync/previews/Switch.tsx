import { useState } from 'react';
import { Switch } from 'lifebalance';

const rowFor = (label: string, node: React.ReactNode): React.ReactNode => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, width: 260 }}>
    <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
    {node}
  </div>
);

export const Accent = () => {
  const [on, setOn] = useState(true);
  return <>{rowFor('Bill reminders', <Switch checked={on} onCheckedChange={setOn} aria-label="Bill reminders" />)}</>;
};

export const Warm = () => {
  const [on, setOn] = useState(true);
  return <>{rowFor('Streak freeze', <Switch checked={on} onCheckedChange={setOn} tone="warm" aria-label="Streak freeze" />)}</>;
};

export const Off = () => {
  const [on, setOn] = useState(false);
  return <>{rowFor('Weekly recap email', <Switch checked={on} onCheckedChange={setOn} aria-label="Weekly recap email" />)}</>;
};

export const Disabled = () => (
  <>{rowFor('Managed by parent', <Switch checked disabled onCheckedChange={() => {}} aria-label="Managed by parent" />)}</>
);
