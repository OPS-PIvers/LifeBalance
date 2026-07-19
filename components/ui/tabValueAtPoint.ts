/**
 * Hit-test a viewport point against the tab triggers inside `container`.
 * While a TabSubViewMenu is open, its full-screen click-away backdrop covers
 * the tab bar, so a tap on another tab reaches the page's capture handler
 * with the backdrop as `target` — geometry is the only way to recover which
 * trigger (if any) the tap actually landed on, letting tab-to-tab taps
 * switch menus in one tap instead of dead-ending in a dismiss.
 */
export function tabValueAtPoint(
  container: HTMLElement | null,
  x: number,
  y: number
): string | null {
  if (!container) return null;
  for (const trigger of container.querySelectorAll<HTMLElement>('[data-tabs-value]')) {
    const r = trigger.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return trigger.getAttribute('data-tabs-value');
    }
  }
  return null;
}
