/**
 * Pure, dependency-free helpers for building and parsing shareable
 * household-invite links.
 *
 * The app uses HashRouter, so the route lives in the URL fragment and the
 * query string must be placed **after** the hash (e.g.
 * `https://app.example/#/setup?invite=ABC123`). A query before the hash
 * would never reach react-router's `useSearchParams`.
 *
 * Invite codes are stored uppercase (see `generateInviteCode`, which draws
 * from `A-Z0-9`, and `joinHousehold`, which uppercases before lookup), so the
 * parser normalizes to uppercase to match.
 */

const SETUP_ROUTE = '#/setup';

/**
 * Build a one-tap shareable invite URL that deep-links into the join flow
 * with the code pre-filled.
 *
 * @param code - The household invite code.
 * @returns An absolute URL (or a relative `#/setup?invite=...` fallback when
 *   `window` is unavailable, e.g. during SSR).
 */
export const buildInviteUrl = (code: string): string => {
  const query = `${SETUP_ROUTE}?invite=${encodeURIComponent(code)}`;

  if (typeof window === 'undefined') {
    return query;
  }

  return `${window.location.origin}${window.location.pathname}${query}`;
};

/**
 * Extract and normalize the invite code from a location search string.
 *
 * @param search - A location search string, e.g. `?invite=abc123` (a leading
 *   `?` is optional; `URLSearchParams` handles both forms).
 * @returns The trimmed, uppercased invite code, or `null` when the `invite`
 *   param is missing or empty.
 */
export const parseInviteCode = (search: string): string | null => {
  const params = new URLSearchParams(search);
  const raw = params.get('invite');

  if (raw === null) {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  return normalized === '' ? null : normalized;
};
