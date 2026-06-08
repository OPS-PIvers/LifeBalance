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
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700 p-3 rounded-xl shadow-2xl z-dropdown">
        <p className="text-slate-400 text-xs font-bold mb-1">{label}</p>
        {payload.map((entry, index) => (
          <div key={`${entry.name ?? 'entry'}-${index}`} className="flex items-center gap-2 text-sm">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: entry.color || entry.fill }}
            />
            <span className="text-slate-300 font-medium">{entry.name}:</span>
            <span className="text-white font-bold font-mono">
              {formatter && typeof entry.value === 'number' ? formatter(entry.value) : entry.value}{suffix}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};
