import React, { useRef } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext';
import { cn } from '@/utils/cn';
import { haptic } from '@/utils/haptics';

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={16} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} /> },
  { value: 'system', label: 'System', icon: <Monitor size={16} /> },
];

/**
 * Three-way appearance selector (Light / Dark / System) backed by ThemeContext.
 *
 * Implements the ARIA radiogroup pattern: roving tabIndex (only the checked
 * option is in the tab order) with arrow keys moving selection + focus.
 */
export const ThemeToggle: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (value: ThemePreference) => {
    setTheme(value);
    haptic('light');
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + OPTIONS.length) % OPTIONS.length;
    if (next === null) return;
    e.preventDefault();
    select(OPTIONS[next]!.value); // next is always a valid index: modulo OPTIONS.length
    btnRefs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-2">
      {OPTIONS.map((opt, index) => {
        const isActive = theme === opt.value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              btnRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(opt.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 py-3 rounded-btn border text-xs font-bold tracking-tight transition-all duration-(--duration-fast) ease-(--ease-standard) active:scale-[0.98] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/30',
              isActive
                ? 'bg-accent-600 text-white border-accent-600 dark:bg-accent-500 dark:text-white dark:border-accent-500'
                : 'bg-white text-brand-500 border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:bg-brand-800 dark:text-brand-400 dark:border-brand-700 dark:hover:bg-brand-700/50 dark:hover:text-brand-200'
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};
