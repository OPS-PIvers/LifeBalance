/**
 * Deep link for the monthly money recap (F-MONEY-06).
 *
 * The money-recap push (public/sw.js) opens `/?moneyrecap=<month>`; the app
 * consumes the param on Dashboard mount and auto-opens the money-recap detail
 * drawer. Mirrors `utils/recapParam.ts`'s dual-path parsing: the param may sit
 * in the real query string (`/?moneyrecap=2026-06` — the SW `openWindow` path,
 * where the SW may also append its own `nsrc` tag) or inside the HashRouter
 * hash (`/#/?moneyrecap=2026-06`). Dependency-free.
 */

export const MONEY_RECAP_PARAM = 'moneyrecap';

/**
 * Read + strip the `moneyrecap` param from a full href. Returns the month value
 * (yyyy-MM, or null) and the href with the param removed. Pure — exported for
 * tests; app code should call `consumeMoneyRecapParam()`.
 */
export function extractMoneyRecapParam(href: string): { month: string | null; cleanedHref: string } {
  try {
    const url = new URL(href);

    const fromSearch = url.searchParams.get(MONEY_RECAP_PARAM);
    if (fromSearch !== null) {
      url.searchParams.delete(MONEY_RECAP_PARAM);
      return { month: fromSearch, cleanedHref: url.toString() };
    }

    const queryStart = url.hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.hash.slice(queryStart + 1));
      const fromHash = params.get(MONEY_RECAP_PARAM);
      if (fromHash !== null) {
        params.delete(MONEY_RECAP_PARAM);
        const rest = params.toString();
        url.hash = url.hash.slice(0, queryStart) + (rest ? `?${rest}` : '');
        return { month: fromHash, cleanedHref: url.toString() };
      }
    }

    return { month: null, cleanedHref: href };
  } catch {
    return { month: null, cleanedHref: href };
  }
}

/**
 * Consume the `moneyrecap` deep-link param from the current URL: returns the
 * target month (or null when absent/empty) and strips the param from the
 * address bar. Safe to call unconditionally — no-ops without the param, never
 * throws.
 */
export function consumeMoneyRecapParam(): string | null {
  if (typeof window === 'undefined') return null;
  const { month, cleanedHref } = extractMoneyRecapParam(window.location.href);
  if (month === null || month === '') return null;
  try {
    window.history.replaceState(window.history.state, '', cleanedHref);
  } catch {
    // Best-effort cleanup; the value has already been read.
  }
  return month;
}
