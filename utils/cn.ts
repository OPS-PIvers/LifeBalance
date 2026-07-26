import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's stock scales, so any font size added in
 * `index.css`'s `@theme` block has to be registered here. Without it `text-xxs`
 * falls through to the `text-<colour>` group and is treated as CONFLICTING with
 * the colour utilities — one of the two is then silently dropped depending on
 * argument order, which is how every `<Badge size="sm">` lost its variant
 * colour and `<Eyebrow size="xxs">` silently rendered at the inherited size.
 *
 * Keep this in sync with the `--text-*` tokens in `index.css`: `text-xxs` is
 * currently the only custom one. Add new tokens here in the same breath as the
 * `@theme` entry, or they will hit the same class of bug.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['xxs'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
