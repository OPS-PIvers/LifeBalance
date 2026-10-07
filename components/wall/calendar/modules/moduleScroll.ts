import { createContext, useContext } from 'react';

/**
 * A Week-screen module's auto scroll: whether it's started, and where the
 * module's list reports that it's longer than its box (the heading shows the
 * start/stop control only then, since a list that fits has nothing to scroll).
 * Outside a module (no provider) lists turn and nobody listens.
 */
export interface ModuleScroll {
  on: boolean;
  onOverflow: (overflows: boolean) => void;
}

const noop = () => undefined;

export const ModuleScrollContext = createContext<ModuleScroll>({ on: true, onOverflow: noop });

export const useModuleScroll = (): ModuleScroll => useContext(ModuleScrollContext);
