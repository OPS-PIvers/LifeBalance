import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import {
  SegmentedControl,
  type SegmentedControlOption,
} from '@/components/ui/SegmentedControl';
import { haptic } from '@/utils/haptics';

const stacked = (icon: React.ReactNode, label: string) => (
  <span className="flex flex-col items-center gap-1">
    {icon}
    {label}
  </span>
);

const OPTIONS: SegmentedControlOption<ThemePreference>[] = [
  { value: 'light', label: stacked(<Sun size={16} />, 'Light'), ariaLabel: 'Light' },
  { value: 'dark', label: stacked(<Moon size={16} />, 'Dark'), ariaLabel: 'Dark' },
  { value: 'system', label: stacked(<Monitor size={16} />, 'System'), ariaLabel: 'System' },
];

/**
 * Three-way appearance selector (Light / Dark / System) backed by ThemeContext.
 * Built on the shared SegmentedControl primitive so it inherits the canonical
 * radiogroup behavior (roving tabindex + arrow keys), radius, active pill, and
 * focus ring instead of hand-rolling them.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl
      name="Appearance"
      options={OPTIONS}
      value={theme}
      onChange={(value) => {
        setTheme(value);
        haptic('light');
      }}
    />
  );
};
