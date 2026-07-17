/**
 * Theme-aware color palette for recharts-based charts.
 *
 * Recharts renders literal SVG color props (`fill`, `stroke`, `stopColor`) —
 * these are plain strings baked in at render time, not CSS that reacts to a
 * `.dark` class toggle. Charts that hardcoded a single hex value (as
 * `BudgetTrends.tsx`/`NetWorthTrendChart.tsx`/`HabitsInsightsCharts.tsx` used
 * to) silently pick ONE theme's color and use it in both — most visibly, axis
 * tick text was hardcoded to `#a8a399` (the DARK-mode value of `brand-400`),
 * which measures only ~2.5:1 against a white light-mode chart card (fails the
 * WCAG 3:1 non-text minimum).
 *
 * This module is the single source of truth for chart colors, split by
 * resolved theme, mirroring the *actual* token values defined in
 * `index.css`'s `@theme` block and its `.dark` override. `useChartTheme`
 * (`hooks/useChartTheme.ts`) selects between `LIGHT_CHART_THEME` and
 * `DARK_CHART_THEME` based on `useTheme().resolvedTheme` — never
 * `window.matchMedia`, which can desync from the app's own theme toggle
 * (see PR #994).
 *
 * KEEP THESE VALUES IN SYNC WITH index.css's `@theme` block and its `.dark`
 * override. Only `brand-*` (text/neutrals) and `money-pos`/`money-neg` are
 * theme-split in index.css; `accent-*` and `warm-*` are NOT theme-split (same
 * hex in both themes), which is why some series colors below intentionally
 * shift to a lighter accent step in dark mode — not because the *token*
 * changed, but because a fixed accent-600 line reads at only ~1.9:1 against
 * the dark `surface-section` background (`brand-800`, #242220) and needs a
 * lighter step to stay visible/legible there.
 */

export interface ChartTheme {
  /** Axis tick label text. brand-400 — 4.86:1 (light, on white) / 6.31:1 (dark, on brand-800). */
  axisText: string;
  /** CartesianGrid stroke — brand-400 at low alpha; non-text, decorative. */
  gridStroke: string;
  /** Secondary/reference line stroke (e.g. "ideal pace"), same tone as axisText. */
  seriesMuted: string;
  /** Reference/threshold line stroke (e.g. "budget cap") — money-neg token. */
  seriesReference: string;
  /** Primary data line/area stroke — accent-600 (light, 8.29:1 on white) / accent-400 (dark, 3.95:1 on brand-800). */
  seriesPrimary: string;
  /** Gradient fill stops for the primary series area, top → bottom. */
  seriesPrimaryGradient: readonly [string, string];
  /** Ranked ramp for stacked/multi-series category charts, deepest/most-prominent first. */
  trendRamp: readonly [string, string, string, string, string];
  /** Catch-all "Other" bucket color for trend charts — same tone as axisText/seriesMuted. */
  trendOther: string;
  /** 5-step low→high intensity ramp for the habit consistency heatmap. */
  heatmapRamp: readonly [string, string, string, string, string];
  /** Always-dark tooltip chip (CustomTooltip is intentionally theme-invariant — a fixed "ink" chip for legibility in both themes), exposed here for any chart that builds tooltip styling in JS rather than Tailwind classes. */
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;
}

// -- index.css @theme (light) -----------------------------------------------
// --color-brand-400: #767165  (light tertiary text — 4.54:1 on brand-50)
// --color-accent-600: #285742 (PRIMARY evergreen)
// --color-accent-500: #356f54
// --color-accent-400: #538a70
// --color-accent-300: #84ad97
// --color-accent-200: #b3cdbd
// --color-accent-100: #d8e6dd
// --color-accent-50:  #eef3ef
// --color-money-neg:  #b93830
// --color-brand-900:  #161512
// --color-brand-700:  #3a3731
// --color-brand-300:  #cbc7bb
export const LIGHT_CHART_THEME: ChartTheme = {
  axisText: '#767165', // brand-400
  gridStroke: 'rgba(118, 113, 101, 0.22)', // brand-400 @ low alpha
  seriesMuted: '#767165', // brand-400
  seriesReference: '#b93830', // money-neg
  seriesPrimary: '#285742', // accent-600
  seriesPrimaryGradient: ['#285742', '#285742'],
  trendRamp: ['#285742', '#356f54', '#538a70', '#84ad97', '#b3cdbd'], // accent-600..200
  trendOther: '#767165', // brand-400
  heatmapRamp: ['#e3e0d8', '#b3cdbd', '#84ad97', '#356f54', '#214636'], // brand-200, accent-200/300/500/700
  tooltipBg: '#161512', // brand-900
  tooltipBorder: '#3a3731', // brand-700
  tooltipText: '#ffffff',
  tooltipMuted: '#cbc7bb', // brand-300
};

// -- index.css .dark overrides -----------------------------------------------
// --color-brand-400: #a8a399 (dark tertiary text — 6.31:1 on brand-800)
// --color-money-neg: #cc433a (dark FILL variant)
// accent-* is NOT theme-split; accent-400/300/200/100/50 chosen here purely
// for on-dark-surface legibility (see module comment above).
// --color-brand-700:  #3a3731 (used as the heatmap's "no activity" dark tier)
export const DARK_CHART_THEME: ChartTheme = {
  axisText: '#a8a399', // brand-400 (dark)
  gridStroke: 'rgba(168, 163, 153, 0.25)', // brand-400 (dark) @ low alpha
  seriesMuted: '#a8a399', // brand-400 (dark)
  seriesReference: '#cc433a', // money-neg (dark fill variant)
  seriesPrimary: '#538a70', // accent-400 — 3.95:1 on brand-800 (accent-600 is only ~1.9:1)
  seriesPrimaryGradient: ['#538a70', '#538a70'],
  trendRamp: ['#538a70', '#84ad97', '#b3cdbd', '#d8e6dd', '#eef3ef'], // accent-400..50, shifted lighter for dark-surface legibility
  trendOther: '#a8a399', // brand-400 (dark)
  heatmapRamp: ['#3a3731', '#356f54', '#538a70', '#84ad97', '#b3cdbd'], // brand-700 (no-activity), accent-500/400/300/200
  tooltipBg: '#161512', // brand-900 — the tooltip chip is intentionally invariant across themes
  tooltipBorder: '#3a3731', // brand-700
  tooltipText: '#ffffff',
  tooltipMuted: '#cbc7bb', // brand-300
};

/** Resolves the chart palette for a given resolved app theme. */
export function getChartTheme(resolvedTheme: 'light' | 'dark'): ChartTheme {
  return resolvedTheme === 'dark' ? DARK_CHART_THEME : LIGHT_CHART_THEME;
}
