/**
 * Update detection for the wall (docs/plans/wall-display-kiosk.md §12
 * "Reloads"). The wall reloads only when a new version is deployed, and only
 * during the night window, because a reload locks the iPad's audio and mic
 * again until someone touches the screen.
 *
 * A deploy changes the hashed entry script that index.html loads, so the
 * running page compares its own entry script with the one the server's
 * index.html names now.
 */

const SCRIPT_TAG_RE = /<script\b[^>]*>/gi;
const SRC_RE = /\ssrc=["']([^"']+)["']/i;
const MODULE_RE = /\stype=["']module["']/i;

/** The hashed entry script an index.html loads, e.g. "/assets/index-AbC123.js". */
export function entryScriptOf(html: string): string | null {
  for (const tag of html.match(SCRIPT_TAG_RE) ?? []) {
    const src = SRC_RE.exec(tag)?.[1];
    if (src && MODULE_RE.test(tag) && /\/assets\/[^/]+\.js$/.test(new URL(src, 'https://x').pathname)) {
      return new URL(src, 'https://x').pathname;
    }
  }
  return null;
}

/** The entry script this page was loaded with (null in dev, where there's no hashed bundle). */
export function runningEntryScript(doc: Document): string | null {
  const el = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return el ? new URL(el.src, 'https://x').pathname : null;
}

/** True when the server is serving a different build than this page runs. */
export function isUpdateAvailable(running: string | null, served: string | null): boolean {
  return Boolean(running && served && running !== served);
}

/** How often the wall asks whether a new version is out. */
export const UPDATE_CHECK_MS = 30 * 60 * 1000;
