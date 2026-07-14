import { describe, it, expect } from 'vitest';
import { extractMoneyRecapParam } from './moneyRecapParam';

const ORIGIN = 'https://app.example.com';

describe('extractMoneyRecapParam (mirrors the sw.js push URL shapes)', () => {
  it('reads and strips the param from the real query string', () => {
    const { month, cleanedHref } = extractMoneyRecapParam(`${ORIGIN}/?moneyrecap=2026-06`);
    expect(month).toBe('2026-06');
    expect(cleanedHref).toBe(`${ORIGIN}/`);
  });

  it('survives the SW nsrc tagging appended after it', () => {
    const { month, cleanedHref } = extractMoneyRecapParam(
      `${ORIGIN}/?moneyrecap=2026-06&nsrc=monthly_money_recap`
    );
    expect(month).toBe('2026-06');
    expect(cleanedHref).toBe(`${ORIGIN}/?nsrc=monthly_money_recap`);
  });

  it('reads and strips the param from inside a HashRouter hash', () => {
    const { month, cleanedHref } = extractMoneyRecapParam(`${ORIGIN}/#/?moneyrecap=2026-06`);
    expect(month).toBe('2026-06');
    expect(cleanedHref).toBe(`${ORIGIN}/#/`);
  });

  it('preserves other hash-query params when stripping', () => {
    const { month, cleanedHref } = extractMoneyRecapParam(`${ORIGIN}/#/?tab=bills&moneyrecap=2026-06`);
    expect(month).toBe('2026-06');
    expect(cleanedHref).toBe(`${ORIGIN}/#/?tab=bills`);
  });

  it('returns null and the original href when no param is present', () => {
    const href = `${ORIGIN}/#/habits`;
    expect(extractMoneyRecapParam(href)).toEqual({ month: null, cleanedHref: href });
  });

  it('never throws on malformed input', () => {
    expect(() => extractMoneyRecapParam('not a url')).not.toThrow();
    expect(extractMoneyRecapParam('not a url')).toEqual({ month: null, cleanedHref: 'not a url' });
  });
});
