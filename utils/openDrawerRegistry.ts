/**
 * Registry of the bottom sheets (`components/ui/Drawer`) that are open right
 * now, newest last.
 *
 * Two things need it:
 *
 * 1. `Drawer` itself scopes Escape to the TOPMOST sheet, so nesting a picker
 *    inside a review sheet closes one layer per press instead of all of them.
 * 2. Surfaces that open a sheet on their own initiative — today only
 *    `MainLayout`'s once-per-app-open review drawer — need to know whether the
 *    user is already looking at one, so they can wait their turn instead of
 *    slamming a second modal over the first.
 *
 * It is a module-level store rather than context on purpose: `Drawer` is
 * mounted from ~40 hosts and the alternative is a provider every one of them
 * has to sit inside. Read it through `useOpenDrawerCount` (a
 * `useSyncExternalStore` wrapper), never by importing the array into a render
 * body — module-mutable state read during render tears under concurrent
 * rendering.
 */

/** Opaque per-drawer identity. Symbols so two drawers can never collide. */
export type OpenDrawerId = symbol;

const openDrawerStack: OpenDrawerId[] = [];
const listeners = new Set<() => void>();

/**
 * Marks `id` open and returns the matching close callback. Calling the returned
 * function twice is safe (the second call is a no-op).
 */
export function registerOpenDrawer(id: OpenDrawerId): () => void {
  openDrawerStack.push(id);
  notify();
  return () => {
    const i = openDrawerStack.indexOf(id);
    if (i === -1) return;
    openDrawerStack.splice(i, 1);
    notify();
  };
}

/** The drawer on top of the stack, or `undefined` when nothing is open. */
export function getTopOpenDrawerId(): OpenDrawerId | undefined {
  return openDrawerStack[openDrawerStack.length - 1];
}

/**
 * How many drawers are open. Referentially stable across unrelated renders (a
 * number), which is what makes it a safe `useSyncExternalStore` snapshot —
 * returning the array itself would loop, since a fresh copy is never `===`.
 */
export function getOpenDrawerCount(): number {
  return openDrawerStack.length;
}

/** Subscribes to open/close transitions. Returns the unsubscribe callback. */
export function subscribeOpenDrawers(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Test-only: drops every registration so a suite that unmounts mid-animation
 * doesn't leak an "open" drawer into the next test. Deliberately leaves
 * `listeners` alone — subscribers unsubscribe themselves on unmount, and
 * clearing them would silently deafen a component that is still mounted.
 */
export function resetOpenDrawersForTest(): void {
  openDrawerStack.length = 0;
  notify();
}
