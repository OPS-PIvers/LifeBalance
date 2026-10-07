import { useLayoutEffect, type RefObject } from 'react';
import { isPWA } from '@/utils/platform';
import { wallFillHeight } from '@/utils/wall/wallViewport';

/**
 * Sizes the wall to the whole screen in a Home Screen app whose viewport comes
 * up a status bar short (utils/wall/wallViewport.ts). Otherwise the wall keeps
 * its CSS height.
 */
export function useWallViewport(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window.matchMedia !== 'function') return undefined;
    const apply = () => {
      const height = wallFillHeight({
        standalone: isPWA(),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
      });
      if (height) el.style.height = `${height}px`;
      else el.style.removeProperty('height');
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [ref]);
}
