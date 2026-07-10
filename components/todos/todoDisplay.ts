import { type Quadrant } from '@/utils/eisenhower';

// Section accent palette — the three list-view urgency colors plus the two the
// matrix arrangement adds (accent/neutral). Existing DESIGN.md token families only.
// Moved verbatim from pages/ToDosPage.tsx (Plan 27) — shared by the list
// Section, the Eisenhower matrix view, and the 2×2 grid view.
export type SectionColor = 'rose' | 'amber' | 'blue' | 'accent' | 'neutral';

// Non-overdue due-date text color, keyed by section urgency. No background/border
// chrome — a single colored text signal per row, matching the section's accent.
export const dateColorMap = {
  rose: 'text-money-neg dark:text-money-negDark',
  amber: 'text-warm-700 dark:text-warm-300',
  blue: 'text-habit-blue dark:text-habit-blue',
  accent: 'text-accent-600 dark:text-accent-300',
  neutral: 'text-brand-500 dark:text-brand-400',
} as const;

// Section-header accent dot color per section color (shared by the stacked
// sections and the 2×2 grid cells so the two Eisenhower views match).
export const sectionDotColors: Record<SectionColor, string> = {
  rose: 'bg-money-neg',
  amber: 'bg-warm-500',
  blue: 'bg-habit-blue',
  accent: 'bg-accent-600',
  neutral: 'bg-brand-400',
};

// Quadrant display config for the Eisenhower arrangement, in QUADRANT_ORDER.
export const QUADRANT_SECTIONS: Record<Quadrant, { title: string; subtitle: string; color: SectionColor }> = {
  do: { title: 'Do First', subtitle: 'Urgent & Important', color: 'rose' },
  schedule: { title: 'Schedule', subtitle: 'Important, Not Urgent', color: 'accent' },
  delegate: { title: 'Delegate', subtitle: 'Urgent, Not Important', color: 'amber' },
  later: { title: 'Later', subtitle: 'Not Urgent, Not Important', color: 'neutral' },
};
