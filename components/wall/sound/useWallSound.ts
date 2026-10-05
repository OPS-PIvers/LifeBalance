import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { createWallSound, type SoundState, type WallSound } from './wallSound';

export const WallSoundContext = createContext<WallSound | null>(null);

/** The wall's sound engine (null outside a wall, e.g. a lone component test). */
export function useWallSound(): WallSound | null {
  return useContext(WallSoundContext);
}

export function useSoundState(sound: WallSound | null): SoundState {
  return useSyncExternalStore(
    fn => sound?.subscribe(fn) ?? (() => undefined),
    () => sound?.getState() ?? 'unsupported',
    () => 'unsupported'
  );
}

/** iPadOS counts these as a "user gesture" that may start audio. */
const UNLOCK_EVENTS = ['touchend', 'pointerup', 'click', 'keydown'] as const;

/**
 * Owns the wall's one sound engine: keeps its volume and cloud voice current,
 * and unlocks it on the first touch (and again whenever iPadOS suspends it).
 */
export function useWallSoundEngine(volume: number, synthesize: ((text: string) => Promise<string>) | null): WallSound {
  const [sound] = useState(createWallSound);

  useEffect(() => sound.setVolume(volume), [sound, volume]);
  useEffect(() => sound.setSynthesizer(synthesize), [sound, synthesize]);

  useEffect(() => {
    const onGesture = () => {
      if (sound.getState() !== 'ready') sound.unlock();
    };
    UNLOCK_EVENTS.forEach(e => document.addEventListener(e, onGesture, { capture: true, passive: true }));
    return () => UNLOCK_EVENTS.forEach(e => document.removeEventListener(e, onGesture, { capture: true }));
  }, [sound]);

  useEffect(() => () => sound.dispose(), [sound]);
  return sound;
}
