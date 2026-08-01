import { useSyncExternalStore } from 'react';
import { getOpenDrawerCount, subscribeOpenDrawers } from '@/utils/openDrawerRegistry';

/**
 * How many `Drawer` bottom sheets are open right now.
 *
 * `useSyncExternalStore` rather than a plain module read so the value is
 * captured through React's own tearing-safe path — the registry is mutable
 * module state and reading it directly in a render body is impure.
 *
 * The server snapshot is `0`: nothing can be open before hydration.
 */
export function useOpenDrawerCount(): number {
  return useSyncExternalStore(subscribeOpenDrawers, getOpenDrawerCount, () => 0);
}
