/**
 * Deep link for the weekly recap (Plan 02).
 *
 * The recap push (public/sw.js) opens `/?recap=<isoWeek>`; the app consumes the
 * param on Dashboard mount and auto-opens the recap detail drawer. Mirrors
 * `utils/notificationSource.ts`'s dual-path parsing: the param may sit in the
 * real query string (`/?recap=2026-W27` — the SW `openWindow` path, where the
 * SW may also append its own `nsrc` tag) or inside the HashRouter hash
 * (`/#/?recap=2026-W27`). Dependency-free.
 */

export const RECAP_PARAM = 'recap';

/**
 * Read + strip the `recap` param from a full href. Returns the isoWeek value
 * (or null) and the href with the param removed. Pure — exported for tests;
 * app code should call `consumeRecapParam()`.
 */
export function extractRecapParam(href: string): { isoWeek: string | null; cleanedHref: string } {
  try {
    const url = new URL(href);

    const fromSearch = url.searchParams.get(RECAP_PARAM);
    if (fromSearch !== null) {
      url.searchParams.delete(RECAP_PARAM);
      return { isoWeek: fromSearch, cleanedHref: url.toString() };
    }

    const queryStart = url.hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.hash.slice(queryStart + 1));
      const fromHash = params.get(RECAP_PARAM);
      if (fromHash !== null) {
        params.delete(RECAP_PARAM);
        const rest = params.toString();
        url.hash = url.hash.slice(0, queryStart) + (rest ? `?${rest}` : '');
        return { isoWeek: fromHash, cleanedHref: url.toString() };
      }
    }

    return { isoWeek: null, cleanedHref: href };
  } catch {
    return { isoWeek: null, cleanedHref: href };
  }
}

/**
 * Consume the `recap` deep-link param from the current URL: returns the target
 * isoWeek (or null when absent/empty) and strips the param from the address
 * bar. Safe to call unconditionally — no-ops without the param, never throws.
 */
export function consumeRecapParam(): string | null {
  if (typeof window === 'undefined') return null;
  const { isoWeek, cleanedHref } = extractRecapParam(window.location.href);
  if (isoWeek === null || isoWeek === '') return null;
  try {
    window.history.replaceState(window.history.state, '', cleanedHref);
  } catch {
    // Best-effort cleanup; the value has already been read.
  }
  return isoWeek;
}
