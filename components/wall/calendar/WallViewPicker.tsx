import React from 'react';

export type CalendarView = 'day' | 'week' | 'month';

/** 'week' is the resting screen (the day column and the panel), reached from the rail's Calendar. */
const VIEWS: { key: Exclude<CalendarView, 'week'>; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
];

/**
 * Day · Month in the header of the full-screen calendar views, as a full-size
 * segmented control (a caption-sized switch read as an error). The resting
 * screen has none: the panel's Coming up carries its own Week · Month switch.
 */
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
