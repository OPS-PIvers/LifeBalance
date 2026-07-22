import { useState } from 'react';
import { SegmentedControl } from 'lifebalance';

export const Filter = () => {
  const [v, setV] = useState('active');
  return (
    <div style={{ width: 300 }}>
      <SegmentedControl
        name="To-do filter"
        value={v}
        onChange={setV}
        options={[
          { value: 'all', label: 'All' },
          { value: 'active', label: 'Active' },
          { value: 'completed', label: 'Completed' },
        ]}
      />
    </div>
  );
};

export const Warm = () => {
  const [v, setV] = useState('week');
  return (
    <div style={{ width: 300 }}>
      <SegmentedControl
        name="Range"
        tone="warm"
        value={v}
        onChange={setV}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
    </div>
  );
};

export const Small = () => {
  const [v, setV] = useState('list');
  return (
    <div style={{ width: 220 }}>
      <SegmentedControl
        name="View"
        size="sm"
        value={v}
        onChange={setV}
        options={[
          { value: 'list', label: 'List' },
          { value: 'grid', label: 'Grid' },
        ]}
      />
    </div>
  );
};
