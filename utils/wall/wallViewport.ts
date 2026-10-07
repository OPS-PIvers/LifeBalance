/**
 * The wall's height in a Home Screen app, when the browser reports it short.
 *
 * iPadOS 16 with a translucent status bar lays the page out under the status
 * bar but still sizes the viewport (100vh, 100dvh, innerHeight) as if the bar
 * took up room, so a full-height box stops one status bar short of the bottom
 * and a light strip of the web view shows there. The screen itself is right,
 * so when the viewport comes up a status bar or less short of it, the wall
 * takes the screen's height instead. Anything else (a browser tab, Split View,
 * a correct viewport) → null, and CSS keeps 100dvh.
 */
export interface WallViewportInput {
  standalone: boolean;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/** A status bar is 20–24pt on a Home-button iPad, more with a notch or Dynamic Island. */
const MAX_SHORTFALL = 60;

export function wallFillHeight(v: WallViewportInput): number | null {
  if (!v.standalone || v.innerHeight <= 0) return null;
  // iPadOS has reported screen.width/height both fixed to portrait and swapped
  // with the orientation, so take the side that matches the window's shape.
  const long = Math.max(v.screenWidth, v.screenHeight);
  const short = Math.min(v.screenWidth, v.screenHeight);
  const landscape = v.innerWidth > v.innerHeight;
  const screenTall = landscape ? short : long;
  const screenWide = landscape ? long : short;
  // Not full-screen (Split View, Slide Over): leave it alone.
  if (Math.abs(screenWide - v.innerWidth) > 2) return null;
  const shortfall = screenTall - v.innerHeight;
  if (shortfall <= 0 || shortfall > MAX_SHORTFALL) return null;
  return screenTall;
}
