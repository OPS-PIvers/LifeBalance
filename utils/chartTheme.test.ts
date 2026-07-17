import { describe, it, expect } from 'vitest';
import { LIGHT_CHART_THEME, DARK_CHART_THEME, getChartTheme } from './chartTheme';

// Minimal WCAG relative-luminance/contrast helpers, duplicated here (rather
// than imported) so this test stays a self-contained regression guard against
// silent token drift — it doesn't depend on any app contrast utility existing.
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = relativeLuminance(hexToRgb(hexA));
  const l2 = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

// The chart card background is `surface-section`: white in light mode,
// brand-800 (#242220) in dark mode (index.css `@utility surface-section`).
const LIGHT_CARD_BG = '#ffffff';
const DARK_CARD_BG = '#242220';

describe('chartTheme', () => {
  it('getChartTheme resolves light and dark palettes', () => {
    expect(getChartTheme('light')).toBe(LIGHT_CHART_THEME);
    expect(getChartTheme('dark')).toBe(DARK_CHART_THEME);
  });

  it('axis text meets the WCAG 3:1 non-text minimum against the chart card background in both themes', () => {
    // Regression guard for the original bug: axis ticks were hardcoded to a
    // single hex (#a8a399, the dark-mode brand-400 value) which only measured
    // ~2.5:1 against a white light-mode card.
    expect(contrastRatio(LIGHT_CHART_THEME.axisText, LIGHT_CARD_BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_CHART_THEME.axisText, DARK_CARD_BG)).toBeGreaterThanOrEqual(3);
  });

  it('seriesMuted (secondary/reference line text-adjacent role) also clears 3:1 in both themes', () => {
    expect(contrastRatio(LIGHT_CHART_THEME.seriesMuted, LIGHT_CARD_BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_CHART_THEME.seriesMuted, DARK_CARD_BG)).toBeGreaterThanOrEqual(3);
  });

  it('the primary series line/area is legible against the card background in both themes', () => {
    // accent-600 (#285742) alone only measures ~1.9:1 against the dark card —
    // dark mode intentionally steps to a lighter accent shade.
    expect(contrastRatio(LIGHT_CHART_THEME.seriesPrimary, LIGHT_CARD_BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_CHART_THEME.seriesPrimary, DARK_CARD_BG)).toBeGreaterThanOrEqual(3);
  });

  it('the deepest/most-prominent trend ramp step is legible against the card background in both themes', () => {
    expect(contrastRatio(LIGHT_CHART_THEME.trendRamp[0], LIGHT_CARD_BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(DARK_CHART_THEME.trendRamp[0], DARK_CARD_BG)).toBeGreaterThanOrEqual(3);
  });

  it('light and dark palettes are not simply the same values (theme actually changes)', () => {
    expect(LIGHT_CHART_THEME.axisText).not.toBe(DARK_CHART_THEME.axisText);
    expect(LIGHT_CHART_THEME.seriesPrimary).not.toBe(DARK_CHART_THEME.seriesPrimary);
  });

  it('every ramp/gradient array has the expected fixed length', () => {
    expect(LIGHT_CHART_THEME.trendRamp).toHaveLength(5);
    expect(DARK_CHART_THEME.trendRamp).toHaveLength(5);
    expect(LIGHT_CHART_THEME.heatmapRamp).toHaveLength(5);
    expect(DARK_CHART_THEME.heatmapRamp).toHaveLength(5);
    expect(LIGHT_CHART_THEME.seriesPrimaryGradient).toHaveLength(2);
    expect(DARK_CHART_THEME.seriesPrimaryGradient).toHaveLength(2);
  });

  it('all color values are well-formed hex or rgba strings', () => {
    const hexOrRgba = /^(#[0-9a-f]{6}|rgba\(\d+,\s*\d+,\s*\d+,\s*[0-9.]+\))$/i;
    for (const theme of [LIGHT_CHART_THEME, DARK_CHART_THEME]) {
      const flatValues = [
        theme.axisText,
        theme.gridStroke,
        theme.seriesMuted,
        theme.seriesReference,
        theme.seriesPrimary,
        ...theme.seriesPrimaryGradient,
        ...theme.trendRamp,
        theme.trendOther,
        ...theme.heatmapRamp,
        theme.tooltipBg,
        theme.tooltipBorder,
        theme.tooltipText,
        theme.tooltipMuted,
      ];
      for (const value of flatValues) {
        expect(value).toMatch(hexOrRgba);
      }
    }
  });
});
