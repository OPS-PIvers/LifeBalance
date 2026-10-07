import React from 'react';

export type CalendarView = 'day' | 'week' | 'month';

const VIEWS: { key: CalendarView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

/** Day · Week · Month as a full-size segmented control (a caption-sized switch read as an error). */
const WallViewPicker: React.FC<{ view: CalendarView; onView: (view: CalendarView) => void }> = ({ view, onView }) => (
  <div className="vseg" role="group" aria-label="Calendar view">
    {VIEWS.map(v => (
      <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => onView(v.key)}>
        {v.label}
      </button>
    ))}
  </div>
);

export default WallViewPicker;
