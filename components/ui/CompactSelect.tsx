import React from 'react';

interface CompactSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder: string;
  className?: string;
}

/**
 * Compact select dropdown component used in transaction review flows.
 * Provides consistent styling for small form selects.
 */
export const CompactSelect: React.FC<CompactSelectProps> = ({
  value,
  onChange,
  options,
  placeholder,
  className = ''
}) => {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || '')}
      className={`px-2 py-1 rounded-lg text-xxs font-bold bg-brand-50 border border-brand-200 text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 w-full ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map(opt => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
};
