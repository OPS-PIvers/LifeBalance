import React from 'react';

interface CustomTooltipPayloadEntry {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
  payload?: unknown;
}

export interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayloadEntry[];
  label?: string;
  formatter?: (value: number) => React.ReactNode;
  suffix?: string;
}

export const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, label, formatter, suffix = '' }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-brand-900 border border-brand-700 p-3 rounded-card shadow-raised z-dropdown">
        <p className="text-brand-300 text-xs font-bold mb-1">{label}</p>
        {payload.map((entry, index) => (
          <div key={`${entry.name ?? 'entry'}-${index}`} className="flex items-center gap-2 text-sm">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color || entry.fill }}
            />
            <span className="text-brand-200 font-medium">{entry.name}:</span>
            <span className="text-white font-bold font-mono tabular-nums">
              {formatter && typeof entry.value === 'number' ? formatter(entry.value) : entry.value}{suffix}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};
