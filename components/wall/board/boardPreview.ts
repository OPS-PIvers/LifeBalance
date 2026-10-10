/**
 * The Board layout is a mockup for now (docs: the thread's screenshots):
 * `#/wall?board=1` shows it in place of Week's day column and panel.
 */
export function isBoardPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('board') === '1';
}
