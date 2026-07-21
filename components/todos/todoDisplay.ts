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

// Tinted icon-chip classes per SectionColor — the todos-side replacement for
// borrowing STORE_COLORS on TaskTemplateDrawer (task templates aren't stores;
// they shouldn't reach into the shopping/store color palette). Built entirely
// from existing DESIGN.md token families (accent/warm/money/habit/brand).
export const templateTintClasses: Record<SectionColor, { bg: string; text: string; border: string }> = {
  rose: { bg: 'bg-money-bgNeg dark:bg-money-neg/15', text: 'text-money-neg dark:text-money-negDark', border: 'border-money-neg/30 dark:border-money-neg/40' },
  amber: { bg: 'bg-warm-100 dark:bg-warm-800/40', text: 'text-warm-700 dark:text-warm-300', border: 'border-warm-200 dark:border-warm-700' },
  blue: { bg: 'bg-habit-blue/10 dark:bg-habit-blue/20', text: 'text-habit-blue dark:text-habit-blue', border: 'border-habit-blue/30 dark:border-habit-blue/40' },
  accent: { bg: 'bg-accent-50 dark:bg-accent-800/40', text: 'text-accent-700 dark:text-accent-200', border: 'border-accent-200 dark:border-accent-700' },
  neutral: { bg: 'bg-brand-100 dark:bg-brand-700/40', text: 'text-brand-600 dark:text-brand-300', border: 'border-brand-200 dark:border-brand-600' },
};

// Legacy task-template `color` values were keys into data/storeColors.ts'
// STORE_COLORS (reused from QuickStockList at the time). Templates already
// saved in Firestore may still carry one of those ids — map them onto the
// nearest SectionColor tint so old data keeps a sensible color without this
// module importing store-color constants into a todos surface.
const LEGACY_TEMPLATE_COLOR_TO_SECTION: Record<string, SectionColor> = {
  red: 'rose',
  pink: 'rose',
  orange: 'amber',
  amber: 'amber',
  green: 'accent',
  teal: 'accent',
  blue: 'blue',
  indigo: 'blue',
  purple: 'blue',
  gray: 'neutral',
};

export function getTemplateTint(colorKey?: string): { bg: string; text: string; border: string } {
  const section = (colorKey && LEGACY_TEMPLATE_COLOR_TO_SECTION[colorKey]) || 'neutral';
  return templateTintClasses[section];
}
