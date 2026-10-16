import { createContext, useContext } from 'react';

/**
 * True while the night screen covers the wall: motion underneath has nobody
 * to show it to. Any always-on animation on the wall should read this.
 */
export const WallPausedContext = createContext(false);

export const useWallPaused = (): boolean => useContext(WallPausedContext);
