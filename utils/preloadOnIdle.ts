/**
 * Warm a lazy chunk during browser idle time so the user's first interaction
 * doesn't pay the network round-trip, without competing with app boot.
 *
 * Returns a cancel function (safe to use as a `useEffect` cleanup). Preload
 * failures are swallowed: if the chunk genuinely can't load, `React.lazy`
 * will retry and surface the error when the component is actually opened.
 */
export function preloadOnIdle(load: () => Promise<unknown>, timeoutMs = 3000): () => void {
  const run = () => {
    load().catch(() => {
      // Ignore preload failures; the real load path handles errors.
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }

  // Safari has no requestIdleCallback; a short timeout keeps the preload off
  // the critical boot path.
  const id = window.setTimeout(run, timeoutMs);
  return () => window.clearTimeout(id);
}
