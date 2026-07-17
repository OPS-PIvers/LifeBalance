import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface ViewSwitcherOption<T extends string> {
  value: T;
  label: string;
}

export interface ViewSwitcherProps<T extends string> {
  options: ViewSwitcherOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the select (there is no visible label element). */
  name: string;
  /** Label-text + focus tone. 'accent' (default, evergreen) or 'warm' (amber — gamification surfaces). */
  tone?: 'accent' | 'warm';
  className?: string;
}

const VIEW_SWITCHER_TONES = {
  accent: { text: 'text-accent-700 dark:text-accent-200', ring: 'focus-visible:ring-accent-500/40' },
  warm: { text: 'text-warm-700 dark:text-warm-300', ring: 'focus-visible:ring-warm-500/40' },
} as const;

// ViewSwitcher: a compact inline sub-view dropdown for content headers (the
// GitHub-mobile pattern) — the current view's name + a chevron, reading as part
// of the panel's content rather than a second navigation tier. Built on a
// styled native <select> so keyboard access and the mobile picker sheet come
// for free. Reach for SegmentedControl instead when every option should stay
// visible at once (a filter/value toggle), and for Tabs for primary navigation.
export const ViewSwitcher = <T extends string>({
  options,
  value,
  onChange,
  name,
  tone = 'accent',
  className,
}: ViewSwitcherProps<T>) => {
  const toneStyles = VIEW_SWITCHER_TONES[tone];

  // A "switcher" over one (or zero) views is no choice at all — render nothing.
  // Lets callers pass a conditionally-built option list (e.g. a flag-gated
  // segment) without guarding the mount themselves.
  if (options.length < 2) return null;

  return (
    <div className={cn('relative inline-flex', className)}>
      <select
        value={value}
        aria-label={name}
        onChange={(e) => {
          // Round-trip through the option list so the callback stays typed as T
          // (e.target.value is only ever a rendered option, but prove it).
          const next = options.find((opt) => opt.value === e.target.value);
          if (next) onChange(next.value);
        }}
        className={cn(
          // min-h-11 keeps the native hit target at the 44px floor — a <select>
          // is a replaced element, so Button/TabsTrigger's `before:` hit-area
          // extender can't work here (pseudo-elements don't render on it).
          // text-[16px] on mobile prevents iOS Safari's focus zoom (same trick
          // as CompactSelect); sm:text-sm restores the type ladder on desktop.
          'appearance-none min-h-11 pl-3 pr-8 py-2 rounded-lg cursor-pointer',
          'bg-brand-100 dark:bg-brand-800 border border-brand-200 dark:border-brand-700',
          'text-[16px] sm:text-sm font-semibold outline-hidden',
          'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          'focus-visible:ring-2',
          toneStyles.text,
          toneStyles.ring
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={16}
        aria-hidden="true"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-brand-400 dark:text-brand-450"
      />
    </div>
  );
};
