/**
 * Hand-maintained release highlights for the "What's New" changelog drawer
 * (Settings → What's New). Add a new entry at the TOP of this array whenever
 * `APP_VERSION` in pages/Settings.tsx is bumped — the drawer and the
 * first-run "new version" badge are both keyed off `changelog[0].version`
 * matching `APP_VERSION`.
 */
export interface ChangelogEntry {
  /** Must match APP_VERSION in pages/Settings.tsx for the current release. */
  version: string;
  /** yyyy-MM-dd release date. */
  date: string;
  /** Short, user-facing bullet points — no internal PR/ticket references. */
  highlights: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.8.0-alpha',
    date: '2026-07-14',
    highlights: [
      "Added a \"What's New\" drawer in Settings so you can see recent release highlights.",
      'Pay-at-time-of-bill amounts can now be edited before you confirm a payment.',
      'Reveal, copy, and regenerate your iOS Shortcut API key right from Settings.',
    ],
  },
];
