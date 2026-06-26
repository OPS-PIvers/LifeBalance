import React from 'react';

interface CompactSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  placeholder: string;
  className?: string;
  /** Accessible name for the select when there is no associated visible label. */
  'aria-label'?: string;
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
  className = '',
  'aria-label': ariaLabel,
}) => {
  return (
    <select
      value={value}
      aria-label={ariaLabel ?? placeholder}
      onChange={(e) => onChange(e.target.value || '')}
      className={`px-2 py-1 rounded-sm text-xxs font-bold bg-accent-50 border border-accent-200 text-accent-700 outline-hidden w-full focus-visible:ring-2 focus-visible:ring-accent-500/40 dark:bg-accent-800/40 dark:border-accent-700 dark:text-accent-200 ${className}`}
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
